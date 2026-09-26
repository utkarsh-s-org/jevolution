/** Dedicated process: private model state and an actual A2A JSON-RPC/SSE server. */
import {
  AgentCard,
  CancelTaskRequest,
  GetTaskRequest,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import {
  AgentEvent,
  type AgentExecutor,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler } from '@a2a-js/sdk/server/express';
import express from 'express';

import { CONTRACT, type FoodRequest, type WorkerCommand, type WorkerEvent } from './a2aProtocol.js';
import { choose, ProviderError } from './models.js';

const token = process.env.ARENA_A2A_TOKEN;
if (!token || !process.send) throw new Error('Start A2A workers through the arena runtime.');
const emit = (event: WorkerEvent) => {
  if (process.connected) process.send?.(event);
};
const authenticatedFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};
const clients = new Map<string, ReturnType<ClientFactory['createFromUrl']>>();
const factory = new ClientFactory({
  transports: [new JsonRpcTransportFactory({ fetchImpl: authenticatedFetch })],
  cardResolver: new DefaultAgentCardResolver({ fetchImpl: authenticatedFetch }),
});
function client(url: string) {
  // Endpoints are supplied exclusively over the parent's private IPC channel.
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
    throw new Error('Only configured local peers are supported.');
  let entry = clients.get(url);
  if (!entry) {
    entry = factory.createFromUrl(url);
    clients.set(url, entry);
    entry.catch(() => clients.delete(url));
  }
  return entry;
}
const states = {
  sending: TaskState.TASK_STATE_SUBMITTED,
  submitted: TaskState.TASK_STATE_SUBMITTED,
  working: TaskState.TASK_STATE_WORKING,
  completed: TaskState.TASK_STATE_COMPLETED,
  rejected: TaskState.TASK_STATE_REJECTED,
  failed: TaskState.TASK_STATE_FAILED,
  canceled: TaskState.TASK_STATE_CANCELED,
};
const jobs = new Map<string, { bus: ExecutionEventBus; contextId: string; finish: () => void }>();
const seen = new Set<string>();
const modelCalls = new Map<string, AbortController>();
const store = new InMemoryTaskStore();
function update(taskId: string, state: keyof typeof states, reason: string, receipt?: object) {
  const job = jobs.get(taskId);
  if (!job) return;
  if (receipt)
    job.bus.publish(
      AgentEvent.artifactUpdate(
        TaskArtifactUpdateEvent.fromJSON({
          taskId,
          contextId: job.contextId,
          lastChunk: true,
          artifact: {
            artifactId: taskId + ':receipt',
            name: 'Engine-verified food transfer',
            parts: [{ data: receipt }],
          },
        }),
      ),
    );
  job.bus.publish(
    AgentEvent.statusUpdate(
      TaskStatusUpdateEvent.fromJSON({
        taskId,
        contextId: job.contextId,
        status: {
          state: TaskState[states[state]],
          timestamp: new Date().toISOString(),
          message: {
            messageId: taskId + ':' + state,
            role: 'ROLE_AGENT',
            parts: [{ text: reason }],
          },
        },
      }),
    ),
  );
  if (!['sending', 'submitted', 'working'].includes(state)) {
    jobs.delete(taskId);
    job.finish();
  }
}
class Executor implements AgentExecutor {
  async execute(context: RequestContext, bus: ExecutionEventBus) {
    const data = context.userMessage.parts.find((p) => p.content?.$case === 'data')?.content;
    const request = (data?.$case === 'data' ? data.value : undefined) as unknown as
      FoodRequest | undefined;
    const valid =
      request?.contract === CONTRACT &&
      typeof request.requestId === 'string' &&
      typeof request.runId === 'string' &&
      Number.isSafeInteger(request.requester) &&
      Number.isSafeInteger(request.helper) &&
      Number.isFinite(request.expiresAt);
    const task = Task.fromJSON({
      id: context.taskId,
      contextId: context.contextId,
      status: { state: 'TASK_STATE_SUBMITTED', timestamp: new Date().toISOString() },
      history: [context.userMessage],
    });
    // Passing an already deserialized Message through fromJSON would drop proto oneofs.
    task.history = [context.userMessage];
    bus.publish(AgentEvent.task(task));
    await new Promise<void>((finish) => {
      jobs.set(context.taskId, { bus, contextId: context.contextId, finish });
      if (!valid || !request || seen.has(request.requestId) || seen.size >= 2000) {
        update(context.taskId, 'rejected', 'Invalid, duplicate, or exhausted delivery request.');
        return;
      }
      seen.add(request.requestId);
      emit({ type: 'incoming', request, taskId: context.taskId });
      // The parent validates run, actor, locality and expiry before exposing the inbox.
    });
  }
  async cancelTask(taskId: string) {
    emit({ type: 'canceled', taskId });
    update(taskId, 'canceled', 'Cancellation confirmed by recipient service.');
  }
}
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).end();
    return;
  }
  next();
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('A2A bind failed');
  const url = `http://127.0.0.1:${address.port}`;
  const card = AgentCard.fromJSON({
    name: `Jevolution peer ${process.env.ARENA_A2A_INDEX}`,
    description:
      'Rabbit food-delivery agent; requires the Jevolution food contract and authorized local observations.',
    version: '1.0.0',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: true },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    securitySchemes: { arena: { httpAuthSecurityScheme: { scheme: 'bearer' } } },
    securityRequirements: [{ schemes: { arena: { list: [] } } }],
    skills: [
      {
        id: CONTRACT,
        name: 'Deliver food',
        description:
          'Accept or reject a locally authorized food request. Completion requires an engine receipt.',
        tags: ['jevolution', 'food'],
      },
    ],
  });
  const handler = new DefaultRequestHandler(card, store, new Executor());
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: handler }));
  app.use(
    '/',
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: async () => ({ isAuthenticated: true, userName: 'arena-service' }),
    }),
  );
  emit({ type: 'ready', url });
});
process.on('message', (command: WorkerCommand) => {
  void (async () => {
    if (command.type === 'abort') {
      modelCalls.get(command.id)?.abort();
      return;
    }
    if (command.type === 'update') {
      update(command.taskId, command.state, command.reason, command.receipt);
      return;
    }
    if (command.type === 'choose') {
      const controller = new AbortController();
      modelCalls.set(command.id, controller);
      try {
        const result = await choose(
          command.group,
          command.observation,
          controller.signal,
          command.options,
        );
        emit({ type: 'result', id: command.id, result });
      } finally {
        modelCalls.delete(command.id);
      }
      return;
    }
    const peer = await client(command.url);
    if (command.type === 'cancel') {
      const value = await peer.cancelTask(CancelTaskRequest.fromJSON({ id: command.taskId }));
      emit({ type: 'result', id: command.id, value });
    } else if (command.type === 'inspect') {
      const value = await peer.getTask(
        GetTaskRequest.fromJSON({ id: command.taskId, historyLength: 0 }),
      );
      emit({ type: 'result', id: command.id, value });
    } else {
      let acknowledged = false;
      for await (const event of peer.sendMessageStream(
        SendMessageRequest.fromJSON({
          message: {
            messageId: command.request.requestId,
            contextId: command.request.runId,
            role: 'ROLE_USER',
            parts: [{ data: command.request }],
          },
        }),
        { signal: AbortSignal.timeout(120000) },
      )) {
        const wire = StreamResponse.toJSON(event);
        emit({ type: 'wire', requestId: command.request.requestId, payload: wire });
        if (!acknowledged) {
          acknowledged = true;
          emit({ type: 'result', id: command.id, value: wire });
        }
      }
      if (!acknowledged) throw new Error('A2A stream ended before acknowledging the request.');
    }
  })().catch((error: unknown) => {
    if ('id' in command)
      emit({
        type: 'result',
        id: command.id,
        error: {
          message: error instanceof ProviderError ? error.message : 'A2A worker operation failed',
          status: error instanceof ProviderError ? error.status : 0,
          retryAfterMs: error instanceof ProviderError ? error.retryAfterMs : 0,
          nativeResponse: error instanceof ProviderError ? error.nativeResponse : undefined,
          latencyMs: error instanceof ProviderError ? error.latencyMs : undefined,
        },
      });
    if (command.type === 'send')
      emit({
        type: 'transport-error',
        requestId: command.request.requestId,
        message:
          error instanceof Error
            ? 'A2A: ' + error.message.replaceAll(token!, '[redacted]').slice(0, 400)
            : 'A2A stream failed or expired.',
      });
  });
});
process.on('disconnect', () => {
  server.close();
  process.exit(0);
});
