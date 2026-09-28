import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  CoordinationTask,
  ModelGroup,
  ModelObservation,
  Result,
} from '../../../core/src/evolution/types.js';
import {
  type ChooseOptions,
  CONTRACT,
  ESCAPE_CONTRACT,
  type WorkerCommand,
  type WorkerEvent,
} from './a2aProtocol.js';
import { ProviderError } from './models.js';

export class A2ATransport {
  readonly endpoints: { label: string; url: string }[] = [];
  private children: ChildProcess[] = [];
  private pending = new Map<
    string,
    {
      resolve: (event: Extract<WorkerEvent, { type: 'result' }>) => void;
      reject: (error: Error) => void;
    }
  >();
  private stopped = false;
  private token = randomUUID();
  constructor(
    private onEvent: (event: WorkerEvent, worker: number) => void,
    private onFailure: (message: string) => void,
    private contract: typeof CONTRACT | typeof ESCAPE_CONTRACT = CONTRACT,
  ) {}
  async start() {
    await Promise.all(
      [0, 1].map(
        (index) =>
          new Promise<void>((resolve, reject) => {
            // Running the compiled entry avoids loader/IPC behavior changing in development.
            const entry = path.resolve(
              process.cwd(),
              'dist/arena-server/server/src/evolution/a2aWorker.mjs',
            );
            const child = fork(entry, [], {
              env: {
                ...process.env,
                ARENA_A2A_TOKEN: this.token,
                ARENA_A2A_INDEX: String(index + 1),
                ARENA_A2A_CONTRACT: this.contract,
              },
              stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
              execArgv: [],
            });
            this.children[index] = child;
            const timer = setTimeout(() => {
              reject(new Error('A2A service startup timed out.'));
              this.dispose();
            }, 10000);
            child.on('message', (event: WorkerEvent) => {
              if (event.type === 'ready') {
                this.endpoints[index] = { label: `Agent service ${index + 1}`, url: event.url };
                clearTimeout(timer);
                resolve();
              } else if (event.type === 'result') {
                const pending = this.pending.get(event.id);
                if (event.error) {
                  const error = new ProviderError(
                    event.error.message,
                    event.error.status,
                    event.error.retryAfterMs,
                  );
                  error.nativeResponse = event.error.nativeResponse;
                  error.latencyMs = event.error.latencyMs;
                  pending?.reject(error);
                } else pending?.resolve(event);
              } else this.onEvent(event, index);
            });
            child.once('error', (error) => {
              clearTimeout(timer);
              reject(error);
            });
            child.once('exit', () => {
              clearTimeout(timer);
              reject(new Error('A2A service stopped before startup.'));
              if (!this.stopped) {
                for (const p of this.pending.values())
                  p.reject(new Error('A2A service disconnected.'));
                this.onFailure('A2A service disconnected. Reset the run to reconnect.');
              }
            });
            // Do not pipe SDK/provider errors into user-facing logs (they can contain input).
            child.stderr?.on('data', () => {});
          }),
      ),
    );
  }
  owner(animalId: number) {
    // IDs alternate by lineage in existing worlds. Mix bits so both services host
    // members of each lineage, instead of accidentally partitioning by provider.
    const hash = Math.imul(animalId, 0x45d9f3b);
    return (hash ^ (hash >>> 16)) & 1;
  }
  private async request(
    worker: number,
    command: WorkerCommand & { id: string },
    signal?: AbortSignal,
  ) {
    if (this.stopped || signal?.aborted) throw new Error('A2A operation canceled');
    return new Promise<Extract<WorkerEvent, { type: 'result' }>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.send(worker, { type: 'abort', id: command.id });
        finish(new Error('A2A operation timed out'));
      }, 20000);
      const abort = () => {
        this.send(worker, { type: 'abort', id: command.id });
        finish(new Error('A2A operation canceled'));
      };
      const finish = (error?: Error, event?: Extract<WorkerEvent, { type: 'result' }>) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(command.id);
        if (error) reject(error);
        else resolve(event!);
      };
      this.pending.set(command.id, {
        resolve: (event) => finish(undefined, event),
        reject: (error) => finish(error),
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.send(worker, command);
    });
  }
  private send(worker: number, command: WorkerCommand) {
    const child = this.children[worker];
    if (!this.stopped && child?.connected)
      child.send(command, (error) => {
        if (error && 'id' in command) this.pending.get(command.id)?.reject(error);
      });
  }
  async choose(
    group: ModelGroup,
    observation: ModelObservation,
    signal: AbortSignal,
    options: ChooseOptions,
  ): Promise<Result> {
    const actor = 'rabbit' in observation ? observation.rabbit.id : observation.wolf.id;
    const event = await this.request(
      this.owner(actor),
      { type: 'choose', id: randomUUID(), group, observation, options },
      signal,
    );
    if (!event.result) throw new Error('A2A worker returned no decision');
    return event.result;
  }
  async deliver(task: CoordinationTask) {
    return this.request(this.owner(task.requester), {
      type: 'send',
      id: randomUUID(),
      url: this.endpoints[this.owner(task.helper)].url,
      request: {
        ...(task.kind === 'escape'
          ? { contract: ESCAPE_CONTRACT, escape: task.escape }
          : { contract: CONTRACT }),
        requestId: task.id,
        runId: task.runId,
        requester: task.requester,
        helper: task.helper,
        expiresAt: task.expiresAt,
      },
    });
  }
  update(task: CoordinationTask) {
    if (!task.protocolTaskId) return;
    this.send(this.owner(task.helper), {
      type: 'update',
      taskId: task.protocolTaskId,
      state: task.state,
      reason: task.reason || task.state,
      receipt: task.receipt && {
        ...task.receipt,
        requestId: task.id,
        runId: task.runId,
        requester: task.requester,
        helper: task.helper,
      },
    });
  }
  reject(worker: number, taskId: string) {
    this.send(worker, {
      type: 'update',
      taskId,
      state: 'rejected',
      reason: 'Request is not authorized in this run.',
    });
  }
  async cancel(task: CoordinationTask) {
    if (!task.protocolTaskId) return;
    await this.request(this.owner(task.requester), {
      type: 'cancel',
      id: randomUUID(),
      url: this.endpoints[this.owner(task.helper)].url,
      taskId: task.protocolTaskId,
    });
  }
  async inspect(task: CoordinationTask) {
    if (!task.protocolTaskId) throw new Error('Task has no A2A identifier');
    return (
      await this.request(this.owner(task.requester), {
        type: 'inspect',
        id: randomUUID(),
        url: this.endpoints[this.owner(task.helper)].url,
        taskId: task.protocolTaskId,
      })
    ).value;
  }
  dispose() {
    this.stopped = true;
    for (const pending of [...this.pending.values()])
      pending.reject(new Error('A2A services stopped'));
    for (const child of this.children) {
      if (child.connected) child.disconnect();
      child.kill();
    }
    this.children = [];
  }
}
