import { randomUUID } from 'node:crypto';

import { RULES } from '../../../core/src/evolution/constants.js';
import { vision } from '../../../core/src/evolution/simulation.js';
import type {
  Candidate,
  CoordinationMode,
  CoordinationSnapshot,
  FoodTask,
  FoodTaskState,
  Observation,
  Rabbit,
  World,
} from '../../../core/src/evolution/types.js';
import { visible } from '../../../core/src/evolution/world.js';
import { CONTRACT, type WorkerEvent } from './a2aProtocol.js';
import { A2ATransport } from './a2aTransport.js';

export const activeTask = (task: FoodTask) =>
  ['sending', 'submitted', 'working'].includes(task.state);
const GOAL =
  'Keep the rabbit community alive, across all model groups. Help when the expected benefit justifies your food, time and risk; unnecessary self-sacrifice is not required.';
export class FoodCoordinator {
  private tasks: FoodTask[] = [];
  private nextRequest = new Map<number, number>();
  private sentAt = new Map<string, number>();
  error?: string;
  constructor(
    readonly mode: CoordinationMode,
    readonly runId: string,
    private world: () => World,
    private record: (event: Record<string, unknown>) => void,
    readonly transport?: A2ATransport,
  ) {}
  snapshot(): CoordinationSnapshot {
    const counts: CoordinationSnapshot['counts'] = {
      sending: 0,
      submitted: 0,
      working: 0,
      completed: 0,
      rejected: 0,
      failed: 0,
      canceled: 0,
    };
    for (const t of this.tasks) counts[t.state]++;
    return {
      mode: this.mode,
      skill: 'food',
      tasks: structuredClone(this.tasks.slice(-100)),
      endpoints: this.transport?.endpoints || [],
      counts,
      foodDelivered: this.tasks.reduce((n, t) => n + (t.receipt?.amount || 0), 0),
      error: this.error,
    };
  }
  private contact(a: Rabbit, b: Rabbit) {
    // This first skill requires sight as well as the inherited signal range.
    return visible(this.world(), a, b, Math.min(vision(a), 3 + a.genes.sociability * 5));
  }
  private actors(task: FoodTask) {
    const world = this.world();
    return {
      requester: world.rabbits.find((r) => r.id === task.requester),
      helper: world.rabbits.find((r) => r.id === task.helper),
    };
  }
  private canRequest(r: Rabbit, peer: Rabbit) {
    return (
      r.energy < RULES.hungryEnergy &&
      r.energy > 2 &&
      peer.cargo > 0.1 &&
      this.contact(r, peer) &&
      this.contact(peer, r) &&
      !this.tasks.some((t) => activeTask(t) && (t.requester === r.id || t.helper === peer.id)) &&
      (this.nextRequest.get(r.id) || 0) <= this.world().time &&
      this.tasks.length < 2000
    );
  }
  augment(r: Rabbit, observation: Observation) {
    if (this.mode === 'off') return;
    const world = this.world();
    const requests = this.tasks.filter(
      (t) =>
        t.helper === r.id &&
        ['submitted', 'working'].includes(t.state) &&
        world.time < t.expiresAt &&
        observation.neighbors.some((n) => n.id === t.requester),
    );
    observation.cooperation = {
      goal: GOAL,
      requests: requests.map((t) => ({
        taskId: t.id,
        requester: t.requester,
        age: world.time - t.createdAt,
        expiresIn: t.expiresAt - world.time,
      })),
    };
    for (const task of requests) {
      const share = observation.choices.find(
        (c) => c.action === 'share' && c.recipientId === task.requester,
      );
      if (share)
        observation.choices.push({
          ...share,
          id: `task_${task.id}`,
          description: `${task.state === 'working' ? 'Continue' : 'Accept'} delivery request ${task.id} from rabbit #${task.requester}. ${share.description} Commitment expires in ${(task.expiresAt - world.time).toFixed(1)}s; flee if necessary.`,
          coordination: {
            kind: task.state === 'working' ? 'continue' : 'accept',
            peer: task.requester,
            taskId: task.id,
          },
        });
      if (task.state === 'submitted')
        observation.choices.push({
          id: `reject_${task.id}`,
          action: 'rest',
          description: `Decline food request from rabbit #${task.requester} and rest for this decision. Choose this when helping would be too costly or dangerous.`,
          coordination: { kind: 'reject', peer: task.requester, taskId: task.id },
        });
    }
    for (const peer of world.rabbits
      .filter((p) => p.id !== r.id && this.canRequest(r, p))
      .slice(0, 2))
      observation.choices.push({
        id: `request_${peer.id}`,
        action: 'rest',
        description: `Request food from visible rabbit #${peer.id} carrying ${peer.cargo.toFixed(1)} units; wait here initially. It may accept or decline. Request costs signal energy; no guaranteed delivery.`,
        coordination: { kind: 'request', peer: peer.id },
      });
  }
  validate(r: Rabbit, choice: Candidate): boolean {
    const c = choice.coordination;
    if (!c) return true;
    const peer = this.world().rabbits.find((p) => p.id === c.peer);
    if (!peer) return false;
    if (c.kind === 'request') return this.canRequest(r, peer);
    const task = this.tasks.find((t) => t.id === c.taskId);
    return (
      !!task &&
      activeTask(task) &&
      task.helper === r.id &&
      task.requester === peer.id &&
      this.world().time < task.expiresAt &&
      this.contact(r, peer) &&
      (c.kind === 'reject'
        ? task.state === 'submitted'
        : peer.energy < RULES.hungryEnergy && r.cargo > 0.1)
    );
  }
  applied(r: Rabbit, choice: Candidate, decisionId: string): string | undefined {
    const c = choice.coordination;
    const commitment = this.tasks.find((t) => t.helper === r.id && t.state === 'working');
    if (commitment && (choice.action !== 'share' || choice.recipientId !== commitment.requester))
      this.change(commitment, 'failed', 'Helper chose a different action.');
    if (!c) return commitment?.id;
    const world = this.world();
    if (c.kind === 'request') {
      const peer = world.rabbits.find((p) => p.id === c.peer)!;
      const task: FoodTask = {
        id: randomUUID(),
        runId: this.runId,
        requester: r.id,
        helper: peer.id,
        requesterGroup: r.lineage,
        helperGroup: peer.lineage,
        createdAt: world.time,
        expiresAt: world.time + 20,
        state: 'sending',
        requesterService: this.transport ? this.transport.owner(r.id) + 1 : undefined,
        helperService: this.transport ? this.transport.owner(peer.id) + 1 : undefined,
        decisionId,
        history: [],
      };
      this.tasks.push(task);
      this.nextRequest.set(r.id, world.time + RULES.helpCooldown);
      r.energy -= RULES.signalCost * (1 + r.genes.sociability);
      this.sentAt.set(task.id, performance.now());
      this.change(task, 'sending', 'Model requested a food delivery.');
      if (this.transport)
        void this.transport.deliver(task).catch(() => {
          if (activeTask(task)) {
            this.error = 'Peer request could not be delivered. Reset the run to reconnect.';
            this.change(task, 'failed', this.error);
          }
        });
      return task.id;
    }
    const task = this.tasks.find((t) => t.id === c.taskId)!;
    if (c.kind === 'accept') {
      task.acceptedDecisionId = decisionId;
      task.acceptedAt = world.time;
      this.change(task, 'working', 'Helper model accepted and chose a share action.');
    } else if (c.kind === 'reject')
      this.change(task, 'rejected', 'Helper model declined the request.');
    return task.id;
  }
  onWorkerEvent(event: WorkerEvent, worker: number) {
    if (event.type === 'incoming') {
      const task = this.tasks.find((t) => t.id === event.request.requestId);
      if (
        !task ||
        event.request.contract !== CONTRACT ||
        !activeTask(task) ||
        task.protocolTaskId ||
        event.request.runId !== this.runId ||
        task.requester !== event.request.requester ||
        task.helper !== event.request.helper ||
        task.expiresAt !== event.request.expiresAt ||
        worker !== this.transport?.owner(task.helper)
      ) {
        this.transport?.reject(worker, event.taskId);
        return;
      }
      task.protocolTaskId = event.taskId;
      task.transportMs = performance.now() - (this.sentAt.get(task.id) || performance.now());
      this.record({ type: 'a2a-received', task: structuredClone(task) });
    } else if (event.type === 'wire') this.record({ ...event, type: 'a2a-wire' });
    else if (event.type === 'transport-error') {
      const task = this.tasks.find((t) => t.id === event.requestId);
      if (task && !['completed', 'canceled', 'rejected'].includes(task.state)) {
        if (activeTask(task)) this.change(task, 'failed', event.message);
        this.error = event.message;
      }
    } else if (event.type === 'canceled') {
      const task = this.tasks.find((t) => t.protocolTaskId === event.taskId);
      if (task && activeTask(task)) this.change(task, 'canceled', 'Peer confirmed cancellation.');
    }
  }
  sync() {
    const world = this.world();
    for (const task of this.tasks.filter(activeTask)) {
      const { requester, helper } = this.actors(task);
      // Match real transfers before considering action changes (sharing ends in rest).
      const event =
        task.acceptedAt === undefined
          ? undefined
          : world.reliefEvents.find(
              (e) =>
                e.kind === 'share' &&
                e.actor === task.helper &&
                e.recipient === task.requester &&
                e.time > task.acceptedAt!,
            );
      if (
        event &&
        event.amount > 0 &&
        event.energyBefore !== undefined &&
        event.energyAfter !== undefined
      ) {
        task.receipt = {
          eventId: event.id,
          amount: event.amount,
          energyBefore: event.energyBefore,
          energyAfter: event.energyAfter,
          time: event.time,
        };
        this.change(task, 'completed', 'Food transfer verified by the simulation engine.');
      } else if (!requester || !helper) this.change(task, 'failed', 'An involved rabbit died.');
      else if (world.time >= task.expiresAt)
        this.change(task, 'failed', 'Delivery expired in simulation time.');
      else if (
        task.state === 'sending' &&
        world.time >= task.createdAt + RULES.signalDelay &&
        (!this.transport || task.protocolTaskId)
      ) {
        if (this.contact(requester, helper) && this.contact(helper, requester))
          this.change(task, 'submitted', 'Request arrived in the helper inbox.');
        else this.change(task, 'failed', 'Peer left communication range before delivery.');
      } else if (
        task.state === 'working' &&
        (helper.action !== 'share' || helper.recipientId !== requester.id)
      )
        this.change(
          task,
          'failed',
          'Delivery interrupted by movement, visibility, or another action.',
        );
    }
  }
  private change(task: FoodTask, state: FoodTaskState, reason: string) {
    const wasWorking = task.state === 'working';
    task.state = state;
    task.reason = reason;
    if (wasWorking && ['failed', 'canceled'].includes(state)) {
      const { helper } = this.actors(task);
      if (helper?.action === 'share' && helper.recipientId === task.requester) {
        helper.action = 'rest';
        helper.path = [];
        helper.recipientId = undefined;
      }
    }
    if (!activeTask(task)) task.finishedAt = this.world().time;
    task.history.push({ time: this.world().time, state, reason });
    this.record({ type: 'coordination', task: structuredClone(task) });
    if (state !== 'canceled') this.transport?.update(task);
  }
  cancelAll(reason: string) {
    for (const task of this.tasks.filter(activeTask)) {
      this.change(task, 'canceled', reason);
      if (task.protocolTaskId)
        void this.transport?.cancel(task).catch(() => this.transport?.update(task));
    }
  }
  async inspect(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Unknown coordination task');
    return this.transport ? this.transport.inspect(task) : structuredClone(task);
  }
  dispose() {
    this.transport?.dispose();
  }
}
