import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_CONFIG, RULES, validateGroups } from '../../../core/src/evolution/constants.js';
import { editWorldMap, validateMapEdits } from '../../../core/src/evolution/mapEditor.js';
import { applyDecision, observe, stepWorld } from '../../../core/src/evolution/simulation.js';
import type {
  DecisionTrace,
  Lineage,
  ModelGroup,
  PublicStatus,
  Rabbit,
  RunConfig,
  Snapshot,
  Wolf,
} from '../../../core/src/evolution/types.js';
import { applyWolfDecision, dynamicWolf, observeWolf } from '../../../core/src/evolution/wolves.js';
import { addEvent, createWorld } from '../../../core/src/evolution/world.js';
import { DecisionJournal } from './decisions.js';
import {
  choose,
  defaultGroups,
  MODEL_DEFAULTS,
  ProviderError,
  providerReadiness,
} from './models.js';
import { ReplayStore } from './replay.js';

interface Pending {
  lineage: Lineage;
  controller: AbortController;
  animal: Rabbit | Wolf;
}
export class ArenaRuntime {
  world = createWorld(271828, defaultGroups());
  config: RunConfig = { ...DEFAULT_CONFIG };
  running = false;
  reason = 'Add your API keys, then start the ecosystem.';
  runId = randomUUID();
  connections = 0;
  decisions = new DecisionJournal();
  private epoch = 0;
  private active = new Map<string, Pending>();
  private failures: Record<Lineage, number> = {};
  private backoff: Record<Lineage, number> = {};
  private tickTimer: ReturnType<typeof setInterval>;
  private lastTick = performance.now();
  private directory: string;
  private savedInitial = false;
  replay: ReplayStore;
  constructor(logRoot: string) {
    this.directory = logRoot;
    this.replay = new ReplayStore(logRoot, this.runId);
    this.failures = this.zeros();
    this.backoff = this.zeros();
    this.captureReplay();
    this.tickTimer = setInterval(() => this.tick(), RULES.tickMs);
  }
  private zeros() {
    return Object.fromEntries(this.world.groups.map((g) => [g.id, 0]));
  }
  private actors() {
    return [
      ...this.world.rabbits,
      ...this.world.wolves.filter(
        (w) => this.world.groups.find((g) => g.id === w.lineage)?.controller === 'model',
      ),
    ];
  }
  private ecologyFinished() {
    return !this.world.rabbits.length && !this.world.wolves.some((w) => dynamicWolf(this.world, w));
  }
  private requested() {
    return Object.values(this.world.stats).reduce((sum, s) => sum + s.requested, 0);
  }
  private captureReplay() {
    this.replay.capture(this.snapshot());
  }
  readiness() {
    const ready = providerReadiness();
    return Object.fromEntries(
      this.world.groups.map((g) => [g.id, g.controller === 'deterministic' || ready[g.provider]]),
    );
  }
  status(): PublicStatus {
    const names = Object.fromEntries(
      this.world.groups.map((g) => [
        g.id,
        g.controller === 'deterministic' ? 'Deterministic' : g.model,
      ]),
    );
    const inFlight = this.zeros();
    for (const item of this.active.values()) inFlight[item.lineage]++;
    const backlog = this.zeros();
    for (const r of this.actors())
      if (!r.pending && (r.nextDecision ?? 0) <= this.world.time) backlog[r.lineage!]++;
    const a = this.world.stats;
    const knownPrice =
      this.world.groups.filter((g) => g.controller !== 'deterministic').length === 2 &&
      this.world.groups
        .filter((g) => g.controller !== 'deterministic')
        .every(
          (g) =>
            (g.id === 'jev' && g.provider === 'typesafe' && g.model === MODEL_DEFAULTS.jev) ||
            (g.id === 'claude' && g.provider === 'anthropic' && g.model === MODEL_DEFAULTS.claude),
        );
    return {
      running: this.running,
      providerReady: providerReadiness(),
      replay: { frames: this.replay.frames, intervalMs: RULES.tickMs, error: this.replay.error },
      reason: this.reason,
      ready: this.readiness(),
      models: names,
      inFlight,
      backlog,
      config: { ...this.config },
      runId: this.runId,
      connections: this.connections,
      estimatedCost: knownPrice
        ? (a.jev.inputTokens * 0.042 + a.claude.inputTokens + a.claude.outputTokens * 5) / 1e6
        : null,
    };
  }
  snapshot(): Snapshot {
    return { world: this.world, status: this.status(), decisions: this.decisions.snapshot() };
  }
  private record(event: Record<string, unknown>) {
    try {
      mkdirSync(this.directory, { recursive: true });
      appendFileSync(
        path.join(this.directory, `${this.runId}.jsonl`),
        JSON.stringify({
          wallTime: new Date().toISOString(),
          runId: this.runId,
          simulationTime: this.world.time,
          ...event,
        }) + '\n',
      );
    } catch {
      this.pause('Recording failed. Run stopped to avoid losing decision provenance.');
    }
  }
  start() {
    if (Object.values(this.readiness()).some((ready) => !ready))
      throw new Error('Configure the provider API keys for every selected group in .env.arena.');
    if (this.running) return;
    if (this.active.size)
      throw new Error('Previous calls are still cancelling. Try again in a moment.');
    if (this.requested() >= this.config.maxRequests || this.world.time >= this.config.maxSeconds)
      throw new Error('This run has reached its limit. Export it and reset to start a new run.');
    if (this.ecologyFinished())
      throw new Error(
        'No surviving rabbits or wolves with an active life cycle. Reset to start a new run.',
      );
    if (!this.savedInitial) {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(
        path.join(this.directory, `${this.runId}.initial.json`),
        JSON.stringify({
          world: this.world,
          config: this.config,
          groups: this.world.groups,
          sources: [
            'https://docs.typesafe.ai/api',
            'https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools',
          ],
        }),
      );
      this.savedInitial = true;
    }
    this.running = true;
    this.lastTick = performance.now();
    this.reason = 'Live decisions · world continues during inference';
    this.failures = this.zeros();
    this.record({ type: 'start', config: this.config, groups: this.world.groups });
    this.captureReplay();
  }
  pause(reason = 'Paused. Pending decisions cancelled.') {
    this.running = false;
    this.reason = reason;
    this.epoch++;
    for (const [id, item] of this.active) {
      item.controller.abort();
      const trace = this.decisions.get(item.animal.id).find((entry) => entry.id === id);
      if (trace) this.decisions.update({ ...trace, state: 'cancelled' });
    }
    for (const r of this.actors()) r.pending = false;
    this.captureReplay();
    try {
      this.replay.flush();
    } catch {
      this.replay.error = 'Replay could not be saved to disk.';
    }
  }
  reset(seed: number, config: RunConfig, roster: ModelGroup[] = this.world.groups) {
    if (this.active.size)
      throw new Error('Pending calls are still cancelling. Try resetting in a moment.');
    const groups = validateGroups(roster);
    this.pause();
    this.world = createWorld(seed, groups);
    this.config = { ...config };
    this.runId = randomUUID();
    this.decisions.clear();
    this.replay = new ReplayStore(this.directory, this.runId);
    this.savedInitial = false;
    this.backoff = this.zeros();
    this.reason = 'New habitat ready. Configure keys for the selected providers, then start.';
    this.captureReplay();
  }
  editMap(runId: unknown, revision: unknown, input: unknown) {
    if (this.running) throw new Error('Pause the simulation before editing the map.');
    if (this.active.size)
      throw new Error('Pending decisions are still cancelling. Try again in a moment.');
    if (runId !== this.runId || revision !== (this.world.mapRevision || 0))
      throw new Error('The habitat changed. Close the editor and reopen it to use the latest map.');
    const edits = validateMapEdits(input);
    const result = editWorldMap(this.world, edits);
    this.world = result.world;
    this.epoch++;
    this.reason = `Map updated · ${edits.length} tiles · ${result.relocated} animals moved to safe land.`;
    addEvent(this.world, 'system', this.reason);
    this.record({
      type: 'map-edit',
      edits,
      relocated: result.relocated,
      mapRevision: this.world.mapRevision,
    });
    this.captureReplay();
    try {
      this.replay.flush();
    } catch {
      this.replay.error = 'Replay could not be saved to disk.';
    }
  }
  drought() {
    if (!this.running) throw new Error('Start the ecosystem before triggering a drought.');
    if (this.world.droughtUntil > this.world.time) throw new Error('A drought is already active.');
    this.world.droughtUntil = this.world.time + 60;
    this.world.droughtReport = {
      startedAt: this.world.time,
      endsAt: this.world.droughtUntil,
      cohort: Object.fromEntries(
        this.world.groups.map((g) => [
          g.id,
          this.world.rabbits.filter((r) => r.lineage === g.id).map((r) => r.id),
        ]),
      ),
      baseline: Object.fromEntries(
        this.world.groups.map((g) => [g.id, structuredClone(this.world.stats[g.id].relief)]),
      ),
    };
    addEvent(
      this.world,
      'system',
      'Drought · exposed grass withers for 60 seconds · thirst rises · carried food and caches are protected',
    );
    this.record({ type: 'drought', until: this.world.droughtUntil });
    this.captureReplay();
  }
  private tick() {
    const now = performance.now();
    const elapsed = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.running) return;
    // Avoid silently awarding free survival during laptop sleep or a blocked event loop.
    if (elapsed > 1) {
      this.pause(
        'Host stalled for over 1 second. Resume to continue; this interruption is not model latency.',
      );
      return;
    }
    let remaining = elapsed;
    while (remaining > 0) {
      const dt = Math.min(remaining, RULES.tickMs / 1000);
      stepWorld(this.world, dt);
      remaining -= dt;
    }
    const alive = new Set<Rabbit | Wolf>([...this.world.rabbits, ...this.world.wolves]);
    for (const item of this.active.values()) if (!alive.has(item.animal)) item.controller.abort();
    const requested = this.requested();
    if (
      this.world.time >= this.config.maxSeconds ||
      (requested >= this.config.maxRequests && this.active.size === 0) ||
      this.ecologyFinished()
    ) {
      this.record({ type: 'finished', snapshot: this.snapshot() });
      this.pause('Run complete · export your observations or reset.');
      return;
    }
    const status = this.status();
    // Alternate dispatch order each tick to avoid favoring the same lineage at the call cap.
    const ids = this.world.groups.map((g) => g.id);
    const offset = Math.floor(this.world.time * 20) % ids.length;
    const lineages = [...ids.slice(offset), ...ids.slice(0, offset)];
    for (const lineage of lineages) {
      if (now < this.backoff[lineage]) continue;
      let slots = this.config.maxInFlight - status.inFlight[lineage];
      const due = this.actors()
        .filter(
          (r) => r.lineage === lineage && !r.pending && (r.nextDecision ?? 0) <= this.world.time,
        )
        .sort((a, b) => (a.nextDecision ?? 0) - (b.nextDecision ?? 0) || a.id - b.id);
      for (const rabbit of due) {
        if (slots-- <= 0 || this.requested() >= this.config.maxRequests) break;
        void this.dispatch(rabbit);
      }
    }
    this.captureReplay();
  }
  private async dispatch(rabbit: Rabbit | Wolf) {
    const world = this.world;
    const config = { ...this.config };
    const epoch = this.epoch;
    const lineage = rabbit.lineage!;
    const isWolf = !('genes' in rabbit);
    const group = world.groups.find((g) => g.id === lineage)!;
    const id = randomUUID();
    const stats = world.stats[lineage];
    const controller = new AbortController();
    rabbit.pending = true;
    this.active.set(id, { lineage, controller, animal: rabbit });
    const queueMs = Math.max(0, (world.time - (rabbit.nextDecision ?? 0)) * 1000);
    const observation = 'genes' in rabbit ? observe(world, rabbit) : observeWolf(world, rabbit);
    const started = performance.now();
    stats.requested++;
    stats.queueMs.push(queueMs);
    const deadline = config.timing === 'equalized' ? config.equalizedMs : config.deadlineMs;
    let trace: DecisionTrace = {
      id,
      animalId: rabbit.id,
      species: isWolf ? 'wolf' : 'rabbit',
      lineage,
      label: group.label,
      provider: group.provider,
      model: group.model,
      startedAt: Date.now(),
      simulationTime: world.time,
      deadlineMs: deadline,
      timing: config.timing,
      delayMs: group.delayMs,
      state: 'requesting',
    };
    const traceRun = this.runId;
    const publish = (update: Partial<DecisionTrace>) => {
      trace = { ...trace, ...update };
      if (this.runId === traceRun) this.decisions.update(trace);
    };
    publish({});
    const timeout = setTimeout(
      () => controller.abort(new Error('timeout')),
      Math.max(15000, deadline + 2000),
    );
    this.record({
      type: 'observation',
      id,
      animalId: rabbit.id,
      species: isWolf ? 'wolf' : 'rabbit',
      rabbitId: isWolf ? undefined : rabbit.id,
      lineage,
      queueMs,
      observation,
    });
    try {
      const result = await choose(group, observation, controller.signal);
      stats.inputTokens += result.inputTokens;
      stats.outputTokens += result.outputTokens;
      stats.latencies.push(result.latencyMs);
      rabbit.lastLatency = result.latencyMs;
      // Publish immediately on return, before artificial delay or equal-timing hold.
      publish({
        state: 'returned',
        decision: result.decision,
        nativeResponse: result.nativeResponse,
        model: result.model,
        latencyMs: result.latencyMs,
        action: observation.choices.find((choice) => choice.id === result.decision.choice)
          ?.description,
      });
      if (group.delayMs) await this.delay(group.delayMs, controller.signal);
      const beforeEqualization = performance.now() - started;
      let late = beforeEqualization > deadline;
      if (config.timing === 'equalized' && !late)
        await this.delay(Math.max(0, config.equalizedMs - beforeEqualization), controller.signal);
      const effectiveMs = performance.now() - started;
      if (config.timing === 'realtime') late = effectiveMs > deadline;
      let outcome: DecisionTrace['state'] = 'applied';
      if (
        epoch !== this.epoch ||
        !this.running ||
        !([...world.rabbits, ...world.wolves] as (Rabbit | Wolf)[]).includes(rabbit)
      ) {
        stats.cancelled++;
        outcome = 'cancelled';
      } else if (late) {
        stats.late++;
        outcome = 'late';
      } else if (
        !('wolf' in observation
          ? applyWolfDecision(world, rabbit as Wolf, result.decision, observation.choices)
          : applyDecision(world, rabbit as Rabbit, result.decision, observation.choices))
      ) {
        stats.invalid++;
        outcome = 'invalid';
      } else stats.applied++;
      publish({ state: outcome, effectiveMs });
      this.failures[lineage] = 0;
      this.record({
        type: 'decision',
        id,
        animalId: rabbit.id,
        species: isWolf ? 'wolf' : 'rabbit',
        rabbitId: isWolf ? undefined : rabbit.id,
        lineage,
        result,
        queueMs,
        effectiveMs,
        outcome,
      });
    } catch (error) {
      if (
        epoch !== this.epoch ||
        !this.running ||
        !([...world.rabbits, ...world.wolves] as (Rabbit | Wolf)[]).includes(rabbit)
      ) {
        stats.cancelled++;
        publish({ state: 'cancelled', effectiveMs: performance.now() - started });
        this.record({
          type: 'cancelled',
          id,
          animalId: rabbit.id,
          species: isWolf ? 'wolf' : 'rabbit',
          rabbitId: isWolf ? undefined : rabbit.id,
          lineage,
          usageMayBeUnreported: true,
        });
      } else {
        stats.errors++;
        this.failures[lineage]++;
        const message =
          error instanceof ProviderError
            ? error.message
            : controller.signal.aborted
              ? 'Provider timeout'
              : 'Provider request failed';
        publish({
          state: 'error',
          message,
          effectiveMs: performance.now() - started,
          nativeResponse: error instanceof ProviderError ? error.nativeResponse : undefined,
          latencyMs: error instanceof ProviderError ? error.latencyMs : undefined,
        });
        addEvent(world, 'system', message, lineage);
        this.record({
          type: 'error',
          id,
          animalId: rabbit.id,
          species: isWolf ? 'wolf' : 'rabbit',
          rabbitId: isWolf ? undefined : rabbit.id,
          lineage,
          message,
          status: error instanceof ProviderError ? error.status : null,
          nativeResponse: error instanceof ProviderError ? error.nativeResponse : undefined,
          latencyMs: error instanceof ProviderError ? error.latencyMs : undefined,
          usageMayBeUnreported: true,
        });
        this.backoff[lineage] =
          performance.now() +
          Math.max(
            error instanceof ProviderError ? error.retryAfterMs : 0,
            Math.min(30000, 1000 * 2 ** this.failures[lineage]),
          );
        if (
          this.failures[lineage] >= 3 ||
          (error instanceof ProviderError && [400, 401, 403, 404, 422].includes(error.status))
        )
          this.pause(`${message}. Paused all groups; fix the API configuration before resuming.`);
      }
    } finally {
      clearTimeout(timeout);
      this.active.delete(id);
      if (epoch === this.epoch) {
        rabbit.pending = false;
        rabbit.nextDecision = world.time + config.decisionIntervalMs / 1000;
      }
    }
  }
  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Cancelled'));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Cancelled'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  dispose() {
    this.pause('Server stopped');
    clearInterval(this.tickTimer);
  }
}
