import { randomUUID } from 'node:crypto';

import { rulesFor } from '../../../core/src/evolution/constants.js';
import { vision } from '../../../core/src/evolution/simulation.js';
import type {
  Candidate,
  CoordinationMode,
  CoordinationSnapshot,
  EscapeTask,
  EscapeWarning,
  FoodTaskState,
  Observation,
  Point,
  Rabbit,
  World,
} from '../../../core/src/evolution/types.js';
import {
  addEvent,
  distance,
  findRoute,
  tileAt,
  visible,
} from '../../../core/src/evolution/world.js';
import { ESCAPE_CONTRACT, type WorkerEvent } from './a2aProtocol.js';
import { A2ATransport } from './a2aTransport.js';

const active = (task: EscapeTask) => ['sending', 'submitted', 'working'].includes(task.state);
const samePoint = (a: Point | undefined, b: Point) => !!a && a.x === b.x && a.y === b.y;
const GOAL =
  'Keep yourself and the nearby rabbit population alive. Warn others when you see a wolf, but balance the energy cost and your own escape. A warning is an old local sighting, not live tracking or a guarantee of safety.';

// A directed local warning with a voluntary, physically verified response. Biology,
// wolf perception and the shared scheduler stay unchanged.
export class EscapeCoordinator {
  private tasks: EscapeTask[] = [];
  private nextWarning = new Map<number, number>();
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
    for (const task of this.tasks) counts[task.state]++;
    return {
      mode: this.mode,
      skill: 'escape',
      tasks: structuredClone(this.tasks.slice(-100)),
      endpoints: this.transport?.endpoints || [],
      counts,
      foodDelivered: 0,
      coverArrivals: counts.completed,
      error: this.error,
    };
  }
  private contact(a: Rabbit, b: Rabbit) {
    return visible(this.world(), a, b, Math.min(vision(a), 3 + a.genes.sociability * 5));
  }
  private coverVisible(rabbit: Rabbit, point: Point) {
    const world = this.world(),
      kind = tileAt(world, point)?.kind;
    return (
      (kind === 'forest' || kind === 'shelter') && visible(world, rabbit, point, vision(rabbit))
    );
  }
  private canTravel(rabbit: Rabbit, point: Point) {
    return (
      this.coverVisible(rabbit, point) &&
      distance(rabbit, point) > 0.8 &&
      findRoute(this.world(), rabbit, point).length > 0
    );
  }
  private canWarn(rabbit: Rabbit, peer: Rabbit, warning: EscapeWarning) {
    const world = this.world();
    return (
      rabbit.id !== peer.id &&
      rabbit.energy > 2 &&
      world.time >= warning.observedAt &&
      world.time - warning.observedAt <= 3 &&
      world.wolves.some((w) => visible(world, rabbit, w, vision(rabbit))) &&
      this.contact(rabbit, peer) &&
      this.contact(peer, rabbit) &&
      this.coverVisible(rabbit, warning.refuge) &&
      this.canTravel(peer, warning.refuge) &&
      !this.tasks.some((t) => active(t) && (t.requester === rabbit.id || t.helper === peer.id)) &&
      (this.nextWarning.get(rabbit.id) || 0) <= world.time &&
      this.tasks.length < 2000
    );
  }
  augment(rabbit: Rabbit, observation: Observation) {
    const world = this.world();
    const inbox = this.tasks.filter(
      (t) =>
        t.helper === rabbit.id &&
        ['submitted', 'working'].includes(t.state) &&
        world.time < t.expiresAt,
    );
    observation.cooperation = {
      goal: GOAL,
      requests: inbox.map((t) => ({
        taskId: t.id,
        requester: t.requester,
        age: world.time - t.escape.observedAt,
        expiresIn: t.expiresAt - world.time,
        escape: structuredClone(t.escape),
      })),
    };
    for (const task of inbox) {
      if (this.canTravel(rabbit, task.escape.refuge))
        observation.choices.push({
          id: `escape_${task.id}`,
          action: 'flee',
          target: { ...task.escape.refuge },
          description: `${task.state === 'working' ? 'Continue' : 'Accept'} rabbit #${task.requester}'s warning and move to visible ${tileAt(world, task.escape.refuge)!.kind} at (${task.escape.refuge.x},${task.escape.refuge.y}). Wolf was seen at (${task.escape.threat.x.toFixed(1)},${task.escape.threat.y.toFixed(1)}) ${(world.time - task.escape.observedAt).toFixed(1)}s ago; it may have moved. Arrival is not guaranteed survival. Forest still requires a later hide choice for its concealment benefit.`,
          coordination: {
            kind: task.state === 'working' ? 'continue' : 'accept',
            peer: task.requester,
            taskId: task.id,
          },
        });
      if (task.state === 'submitted')
        observation.choices.push({
          id: `decline_${task.id}`,
          action: 'rest',
          description: `Decline rabbit #${task.requester}'s warning request and rest this turn. You may instead choose any ordinary escape, forage or other action without accepting.`,
          coordination: { kind: 'reject', peer: task.requester, taskId: task.id },
        });
    }
    const cover = observation.choices.filter((c) => c.action === 'hide' && c.target);
    const threat = observation.wolves[0];
    if (!threat) return;
    let offered = 0;
    for (const neighbor of observation.neighbors) {
      const peer = world.rabbits.find((r) => r.id === neighbor.id);
      if (!peer) continue;
      for (const choice of cover) {
        const escape = {
          refuge: { ...choice.target! },
          threat: { ...threat },
          observedAt: observation.environment.time,
        };
        if (!this.canWarn(rabbit, peer, escape)) continue;
        observation.choices.push({
          ...choice,
          id: `warn_${peer.id}`,
          action: 'flee',
          description: `Warn visible rabbit #${peer.id} about the wolf you see and invite it to this visible ${tileAt(world, escape.refuge)!.kind} at (${escape.refuge.x},${escape.refuge.y}), while moving there yourself. Costs signal energy. The recipient can accept or ignore; warning never forces it to follow.`,
          coordination: { kind: 'request', peer: peer.id, escape },
        });
        offered++;
        break;
      }
      if (offered >= 2) break;
    }
  }
  validate(rabbit: Rabbit, choice: Candidate) {
    const c = choice.coordination;
    if (!c) return true;
    if (c.kind === 'request') {
      const peer = this.world().rabbits.find((r) => r.id === c.peer);
      return !!peer && !!c.escape && this.canWarn(rabbit, peer, c.escape);
    }
    const task = this.tasks.find((t) => t.id === c.taskId);
    if (
      !task ||
      task.helper !== rabbit.id ||
      task.requester !== c.peer ||
      this.world().time >= task.expiresAt
    )
      return false;
    if (c.kind === 'reject') return task.state === 'submitted';
    return (
      task.state === (c.kind === 'accept' ? 'submitted' : 'working') &&
      this.canTravel(rabbit, task.escape.refuge)
    );
  }
  applied(rabbit: Rabbit, choice: Candidate, decisionId: string) {
    const c = choice.coordination;
    const commitment = this.tasks.find((t) => t.helper === rabbit.id && t.state === 'working');
    if (
      commitment &&
      (choice.action !== 'flee' || !samePoint(choice.target, commitment.escape.refuge))
    )
      this.change(commitment, 'failed', 'Recipient chose a different action.');
    if (!c) return commitment?.id;
    const world = this.world();
    if (c.kind === 'request') {
      const peer = world.rabbits.find((r) => r.id === c.peer)!;
      const task: EscapeTask = {
        kind: 'escape',
        escape: structuredClone(c.escape!),
        id: randomUUID(),
        runId: this.runId,
        requester: rabbit.id,
        helper: peer.id,
        requesterGroup: rabbit.lineage,
        helperGroup: peer.lineage,
        requesterService: this.transport ? this.transport.owner(rabbit.id) + 1 : undefined,
        helperService: this.transport ? this.transport.owner(peer.id) + 1 : undefined,
        createdAt: world.time,
        expiresAt: world.time + 12,
        state: 'sending',
        decisionId,
        history: [],
      };
      this.tasks.push(task);
      this.nextWarning.set(rabbit.id, world.time + rulesFor(world).helpCooldown);
      rabbit.energy -= rulesFor(world).signalCost * (1 + rabbit.genes.sociability);
      this.sentAt.set(task.id, performance.now());
      this.change(task, 'sending', 'Model warned a nearby rabbit and chose its own escape route.');
      if (this.transport)
        void this.transport.deliver(task).catch(() => {
          if (active(task)) {
            this.error = 'Warning could not reach the peer service. Reset to reconnect.';
            this.change(task, 'failed', this.error);
          }
        });
      return task.id;
    }
    const task = this.tasks.find((t) => t.id === c.taskId)!;
    if (c.kind === 'accept') {
      task.acceptedAt = world.time;
      task.acceptedDecisionId = decisionId;
      task.acceptedPosition = { x: rabbit.x, y: rabbit.y };
      this.change(task, 'working', 'Recipient model accepted and chose to move toward cover.');
    } else if (c.kind === 'reject') this.change(task, 'rejected', 'Recipient model declined.');
    return task.id;
  }
  onWorkerEvent(event: WorkerEvent, worker: number) {
    if (event.type === 'incoming') {
      const task = this.tasks.find((t) => t.id === event.request.requestId),
        request = event.request;
      if (
        !task ||
        !active(task) ||
        task.protocolTaskId ||
        request.contract !== ESCAPE_CONTRACT ||
        request.runId !== this.runId ||
        request.requester !== task.requester ||
        request.helper !== task.helper ||
        request.expiresAt !== task.expiresAt ||
        worker !== this.transport?.owner(task.helper) ||
        !samePoint(request.escape.refuge, task.escape.refuge) ||
        !samePoint(request.escape.threat, task.escape.threat) ||
        request.escape.observedAt !== task.escape.observedAt
      ) {
        this.transport?.reject(worker, event.taskId);
        return;
      }
      task.protocolTaskId = event.taskId;
      task.transportMs = performance.now() - this.sentAt.get(task.id)!;
      this.record({ type: 'a2a-received', task: structuredClone(task) });
    } else if (event.type === 'wire') this.record({ ...event, type: 'a2a-wire' });
    else if (event.type === 'canceled') {
      const task = this.tasks.find((t) => t.protocolTaskId === event.taskId);
      if (task && active(task)) this.change(task, 'canceled', 'Peer confirmed cancellation.');
    } else if (event.type === 'transport-error') {
      const task = this.tasks.find((t) => t.id === event.requestId);
      if (task && active(task)) {
        this.error = event.message;
        this.change(task, 'failed', event.message);
      }
    }
  }
  sync() {
    const world = this.world();
    for (const task of this.tasks.filter(active)) {
      const recipient = world.rabbits.find((r) => r.id === task.helper);
      if (!recipient) {
        this.change(task, 'failed', 'Recipient died before reaching cover.');
        continue;
      }
      if (world.time >= task.expiresAt) {
        this.change(task, 'failed', 'Warning expired in simulation time.');
        continue;
      }
      if (
        task.state === 'sending' &&
        world.time >= task.createdAt + rulesFor(world).signalDelay &&
        (!this.transport || task.protocolTaskId)
      ) {
        const sender = world.rabbits.find((r) => r.id === task.requester);
        if (sender && this.contact(sender, recipient) && this.contact(recipient, sender))
          this.change(task, 'submitted', 'Local warning arrived in the recipient inbox.');
        else
          this.change(
            task,
            'failed',
            'Sender or recipient left communication range before delivery.',
          );
      } else if (task.state === 'working') {
        const terrain = tileAt(world, recipient)?.kind;
        const displacement = distance(recipient, task.acceptedPosition!);
        if (
          distance(recipient, task.escape.refuge) <= 0.6 &&
          Math.floor(recipient.x) === Math.floor(task.escape.refuge.x) &&
          Math.floor(recipient.y) === Math.floor(task.escape.refuge.y) &&
          displacement > 0.2 &&
          (terrain === 'forest' || terrain === 'shelter')
        ) {
          const eventId = world.eventId;
          addEvent(
            world,
            'signal',
            `Rabbit #${recipient.id} reached ${terrain} after rabbit #${task.requester}'s warning. Arrival is not a survival guarantee.`,
            recipient.lineage,
          );
          task.receipt = {
            eventId,
            time: world.time,
            position: { x: recipient.x, y: recipient.y },
            refuge: { ...task.escape.refuge },
            terrain,
            displacement,
          };
          this.change(
            task,
            'completed',
            'Arrival in cover verified by the simulation engine; not a claim of survival benefit.',
          );
        } else if (
          recipient.action !== 'flee' ||
          !samePoint(recipient.target, task.escape.refuge) ||
          !recipient.path.length
        )
          this.change(task, 'failed', 'Movement interrupted before reaching the advertised cover.');
      }
    }
  }
  private change(task: EscapeTask, state: FoodTaskState, reason: string) {
    if (task.state === 'working' && ['failed', 'canceled'].includes(state)) {
      const recipient = this.world().rabbits.find((r) => r.id === task.helper);
      if (recipient?.action === 'flee' && samePoint(recipient.target, task.escape.refuge)) {
        recipient.action = 'rest';
        recipient.path = [];
        recipient.target = undefined;
      }
    }
    task.state = state;
    task.reason = reason;
    if (!active(task)) task.finishedAt = this.world().time;
    task.history.push({ time: this.world().time, state, reason });
    this.record({ type: 'coordination', task: structuredClone(task) });
    if (state !== 'canceled') this.transport?.update(task);
  }
  cancelAll(reason: string) {
    for (const task of this.tasks.filter(active)) {
      this.change(task, 'canceled', reason);
      if (task.protocolTaskId)
        void this.transport?.cancel(task).catch(() => this.transport?.update(task));
    }
  }
  async inspect(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Unknown warning task');
    return this.transport ? this.transport.inspect(task) : structuredClone(task);
  }
  dispose() {
    this.transport?.dispose();
  }
}
