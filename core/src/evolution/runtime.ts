import {
  DEFAULT_CONFIG,
  DEFAULT_SEED,
  PREDATOR_PREY_GROUPS,
  RULES,
  rulesFor,
  validateGroups,
} from './constants.js';
import { canReconsider } from './decisionDynamics.js';
import { DecisionJournal } from './decisions.js';
import { configureExperiments, dependent } from './demographics.js';
import { validateExperimentPreview } from './experimentPreview.js';
import { validateExperiments } from './experiments.js';
import { editWorldMap, validateMapEdits } from './mapEditor.js';
import { ProviderError } from './providerError.js';
import { costBreakdown, experimentReport } from './reporting.js';
import type { RuntimeReplay, RuntimeServices } from './runtimePorts.js';
import { applyDecision, observe, senseWorld, stepWorld } from './simulation.js';
import type {
  DecisionTrace,
  Lineage,
  ModelGroup,
  ModelObservation,
  PublicStatus,
  Rabbit,
  RunConfig,
  Snapshot,
  Wolf,
} from './types.js';
import { applyWolfDecision, dynamicWolf, observeWolf } from './wolves.js';
import { addEvent, createWorld } from './world.js';

const RETRY_AFTER_CAP_MS = 5000;

interface Pending {
  lineage: Lineage;
  controller: AbortController;
  animal: Rabbit | Wolf;
}
export class SimulationRuntime {
  world: ReturnType<typeof createWorld>;
  config: RunConfig = { ...DEFAULT_CONFIG };
  running = false;
  reason = 'Add your API keys, then start the ecosystem.';
  runId: string;
  connections = 0;
  decisions = new DecisionJournal();
  private epoch = 0;
  private active = new Map<string, Pending>();
  private failures: Record<Lineage, number> = {};
  private backoff: Record<Lineage, number> = {};
  private tickTimer: ReturnType<typeof setInterval>;
  private lastTick = performance.now();
  private savedInitial = false;
  private researchRound = 0;
  private researchQueue:
    { animal: Rabbit | Wolf; observation: ModelObservation; queuedAt: number }[] | undefined;
  private researchResults: { animalId: number; apply: () => void; cancel: () => void }[] = [];
  private researchOrder: number[] = [];
  readonly metrics = {
    replayCaptures: 0,
    replayMs: 0,
    logRecords: 0,
    logMs: 0,
    ticks: 0,
    tickMs: 0,
    maxTickMs: 0,
  };
  report() {
    return { ...experimentReport(this.snapshot()), performance: { ...this.metrics } };
  }
  replay: RuntimeReplay;
  private services: RuntimeServices;
  constructor(services: RuntimeServices) {
    this.services = services;
    this.world = createWorld(DEFAULT_SEED, services.defaultGroups());
    this.runId = services.id();
    this.replay = services.createReplay(this.runId);
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
      ...this.world.rabbits.filter((r) => !dependent(this.world, r)),
      ...this.world.wolves.filter(
        (w) =>
          !dependent(this.world, w) &&
          this.world.groups.find((g) => g.id === w.lineage)?.controller === 'model',
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
    const started = performance.now();
    this.replay.capture(this.snapshot());
    this.metrics.replayCaptures++;
    this.metrics.replayMs += performance.now() - started;
  }
  readiness() {
    const ready = this.services.providerReadiness();
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
      if (!r.pending && (r.nextDecision ?? 0) <= this.world.time && canReconsider(this.world, r))
        backlog[r.lineage!]++;
    return {
      running: this.running,
      clock: {
        mode: this.config.experiments?.researchClock ? 'research' : 'realtime',
        round: this.researchRound,
        roundSeconds: 2,
        phase: !this.running
          ? 'paused'
          : this.researchQueue
            ? 'collecting decisions with world paused'
            : 'advancing',
        queued: this.researchQueue?.length ?? 0,
      },
      providerReady: this.services.providerReadiness(),
      replay: { frames: this.replay.frames, intervalMs: RULES.tickMs, error: this.replay.error },
      reason: this.reason,
      ready: this.readiness(),
      models: names,
      inFlight,
      backlog,
      config: { ...this.config },
      runId: this.runId,
      connections: this.connections,
      estimatedCost: costBreakdown(this.world).usd,
    };
  }
  snapshot(): Snapshot {
    return { world: this.world, status: this.status(), decisions: this.decisions.snapshot() };
  }
  private record(event: Record<string, unknown>) {
    const started = performance.now();
    try {
      this.services.record(this.runId, {
        wallTime: new Date().toISOString(),
        runId: this.runId,
        simulationTime: this.world.time,
        ...event,
      });
    } catch {
      this.pause('Recording failed. Run stopped to avoid losing decision provenance.');
    } finally {
      this.metrics.logRecords++;
      this.metrics.logMs += performance.now() - started;
    }
  }
  start() {
    if (Object.values(this.readiness()).some((ready) => !ready))
      throw new Error('Configure server-side API keys for every selected model provider.');
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
      this.services.saveInitial(this.runId, {
        world: this.world,
        config: this.config,
        groups: this.world.groups,
        sources: [
          'https://docs.typesafe.ai/api',
          'https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools',
        ],
      });
      this.savedInitial = true;
    }
    this.running = true;
    this.lastTick = performance.now();
    this.reason = this.config.experiments?.researchClock
      ? 'Research clock · world waits for each decision round.'
      : 'Live decisions · world continues during inference';
    this.failures = this.zeros();
    this.record({ type: 'start', config: this.config, groups: this.world.groups });
    this.captureReplay();
  }
  pause(reason = 'Paused. Pending decisions cancelled.') {
    this.running = false;
    this.reason = reason;
    this.epoch++;
    for (const result of this.researchResults) result.cancel();
    this.researchResults = [];
    this.researchQueue = undefined;
    this.researchOrder = [];
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
    const experimentPreview = validateExperimentPreview(config.experimentPreview);
    const experiments = validateExperiments(config.experiments);
    if (this.active.size)
      throw new Error('Pending calls are still cancelling. Try resetting in a moment.');
    // Predator–prey always runs its preset: Jev rabbits vs Jev wolves with a wolf life cycle.
    const predatorPrey = config.scenario === 'predatorPrey';
    const groups = predatorPrey
      ? PREDATOR_PREY_GROUPS.map((g) => ({ ...g, model: this.services.jevModel?.() || g.model }))
      : validateGroups(roster);
    this.pause();
    this.world = createWorld(seed, groups, config.scenario);
    configureExperiments(this.world, experiments);
    this.config = { ...config, experimentPreview, experiments };
    this.runId = this.services.id();
    this.decisions.clear();
    this.replay = this.services.createReplay(this.runId);
    this.savedInitial = false;
    this.researchRound = 0;
    for (const key of Object.keys(this.metrics) as (keyof typeof this.metrics)[])
      this.metrics[key] = 0;
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
    if (!this.running) return this.advance();
    const started = performance.now();
    try {
      this.advance();
    } finally {
      const elapsed = performance.now() - started;
      this.metrics.ticks++;
      this.metrics.tickMs += elapsed;
      this.metrics.maxTickMs = Math.max(this.metrics.maxTickMs, elapsed);
    }
  }
  private advance() {
    const now = performance.now();
    const elapsed = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.running) return;
    if (this.config.experiments?.researchClock) return this.advanceResearch();
    // Avoid silently awarding free survival during laptop sleep or a blocked event loop.
    if (elapsed > 1) {
      this.pause(
        'Host stalled for over 1 second. Resume to continue; this interruption is not model latency.',
      );
      return;
    }
    // Sim speed: world seconds per real second. Calls per real second are unchanged.
    let remaining = elapsed * (this.config.timeScale ?? 1);
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
      this.pause(
        this.world.time >= this.config.maxSeconds
          ? 'Run complete · simulation horizon reached.'
          : requested >= this.config.maxRequests
            ? 'Request cap reached before simulation horizon · export this partial run.'
            : 'Run stopped · no active population remains.',
      );
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
          (r) =>
            r.lineage === lineage &&
            !r.pending &&
            (r.nextDecision ?? 0) <= this.world.time &&
            canReconsider(this.world, r),
        )
        .sort((a, b) => (a.nextDecision ?? 0) - (b.nextDecision ?? 0) || a.id - b.id);
      for (const rabbit of due) {
        if (slots-- <= 0 || this.requested() >= this.config.maxRequests) break;
        void this.dispatch(rabbit);
      }
    }
    this.captureReplay();
  }
  private advanceResearch() {
    if (this.world.time >= this.config.maxSeconds) {
      this.record({ type: 'finished', snapshot: this.snapshot() });
      this.pause('Run complete · exact simulation horizon reached.');
      return;
    }
    if (this.ecologyFinished()) {
      this.pause('Run stopped · no active population remains.');
      return;
    }
    if (!this.researchQueue) {
      senseWorld(this.world);
      const actors = this.actors()
        .filter((a) => canReconsider(this.world, a))
        .sort((a, b) => a.id - b.id);
      if (this.requested() + actors.length > this.config.maxRequests) {
        this.pause('Request cap cannot cover a complete decision round · partial experiment.');
        return;
      }
      const offset = actors.length ? this.researchRound % actors.length : 0;
      const order = [...actors.slice(offset), ...actors.slice(0, offset)];
      const queuedAt = performance.now();
      this.researchOrder = order.map((a) => a.id);
      this.researchQueue = order.map((animal) => ({
        animal,
        queuedAt,
        observation: structuredClone(
          'genes' in animal ? observe(this.world, animal) : observeWolf(this.world, animal),
        ),
      }));
      this.record({
        type: 'research-round-start',
        round: this.researchRound,
        animalIds: this.researchOrder,
        worldTime: this.world.time,
      });
    }
    // One global concurrency allowance; population size does not change the time an animal experiences.
    while (
      this.running &&
      this.researchQueue.length &&
      this.active.size < this.config.maxInFlight
    ) {
      const job = this.researchQueue.shift()!;
      void this.dispatch(job.animal, job.observation, job.queuedAt);
    }
    if (!this.running || this.researchQueue.length || this.active.size) return;
    const rank = new Map(this.researchOrder.map((id, i) => [id, i]));
    const results = this.researchResults.sort(
      (a, b) => rank.get(a.animalId)! - rank.get(b.animalId)!,
    );
    this.researchResults = [];
    for (const result of results) result.apply();
    if (!this.running) return;
    this.record({
      type: 'research-round-commit',
      round: this.researchRound,
      animalIds: results.map((r) => r.animalId),
      worldTime: this.world.time,
    });
    this.researchQueue = undefined;
    this.researchRound++;
    const target = Math.min(this.config.maxSeconds, this.world.time + 2);
    while (target - this.world.time > 1e-9) {
      stepWorld(this.world, Math.min(RULES.tickMs / 1000, target - this.world.time));
      this.world.time = Math.round(this.world.time * 1e9) / 1e9;
      this.captureReplay();
    }
    this.world.time = target;
    if (this.world.time >= this.config.maxSeconds) {
      this.record({ type: 'finished', snapshot: this.snapshot() });
      this.pause('Run complete · exact simulation horizon reached.');
    }
  }
  private async dispatch(
    rabbit: Rabbit | Wolf,
    frozenObservation?: ModelObservation,
    queuedAt?: number,
  ) {
    const research = !!frozenObservation;
    const world = this.world;
    const config = { ...this.config };
    const epoch = this.epoch;
    const lineage = rabbit.lineage!;
    const isWolf = !('genes' in rabbit);
    const group = world.groups.find((g) => g.id === lineage)!;
    const id = this.services.id();
    const stats = world.stats[lineage];
    const controller = new AbortController();
    rabbit.pending = true;
    this.active.set(id, { lineage, controller, animal: rabbit });
    const queueMs = research
      ? 0
      : Math.max(
          0,
          (world.time -
            Math.max(
              rabbit.nextDecision ?? 0,
              world.experiments?.decisions ? (rabbit.committedUntil ?? 0) : 0,
            )) *
            1000,
        );
    const observation =
      frozenObservation ??
      ('genes' in rabbit ? observe(world, rabbit) : observeWolf(world, rabbit));
    const queueWallMs =
      queuedAt === undefined ? undefined : Math.max(0, performance.now() - queuedAt);
    if (queueWallMs !== undefined) (stats.queueWallMs ??= []).push(queueWallMs);
    const started = performance.now();
    stats.requested++;
    stats.queueMs.push(queueMs);
    const deadline = research
      ? 15000
      : config.timing === 'equalized'
        ? config.equalizedMs
        : config.deadlineMs;
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
      research ? deadline : Math.max(15000, deadline + 2000),
    );
    this.record({
      type: 'observation',
      id,
      animalId: rabbit.id,
      species: isWolf ? 'wolf' : 'rabbit',
      rabbitId: isWolf ? undefined : rabbit.id,
      lineage,
      queueMs,
      queueWallMs,
      observation,
    });
    try {
      const result = await this.services.choose(group, observation, controller.signal, {
        relief: !!rulesFor(world).reliefEnabled,
        predatorPrey: world.scenario === 'predatorPrey',
        experiments: world.experiments,
      });
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
      let late = !research && beforeEqualization > deadline;
      if (!research && config.timing === 'equalized' && !late)
        await this.delay(Math.max(0, config.equalizedMs - beforeEqualization), controller.signal);
      const effectiveMs = performance.now() - started;
      if (!research && config.timing === 'realtime') late = effectiveMs > deadline;
      const applyResult = () => {
        let outcome: DecisionTrace['state'] = 'applied';
        let rejectionReason: string | undefined;
        const reject = (reason: string) => {
          rejectionReason = reason;
        };
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
            ? applyWolfDecision(world, rabbit as Wolf, result.decision, observation.choices, reject)
            : applyDecision(world, rabbit as Rabbit, result.decision, observation.choices, reject))
        ) {
          stats.invalid++;
          outcome = 'invalid';
        } else stats.applied++;
        publish({ state: outcome, effectiveMs, message: rejectionReason });
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
          queueWallMs,
          effectiveMs,
          outcome,
          rejectionReason,
        });
      };
      if (research && epoch === this.epoch && this.running)
        this.researchResults.push({
          animalId: rabbit.id,
          apply: applyResult,
          cancel: () => {
            stats.cancelled++;
            publish({ state: 'cancelled', message: 'Decision round cancelled before commit.' });
            this.record({
              type: 'cancelled',
              id,
              animalId: rabbit.id,
              lineage,
              usageMayBeUnreported: false,
              reason: 'round-cancelled-before-commit',
            });
          },
        });
      else applyResult();
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
            // Honor a provider's Retry-After, but never stall a group for more than a few
            // seconds: an uncapped wait froze every wolf for the rest of a run.
            error instanceof ProviderError ? Math.min(RETRY_AFTER_CAP_MS, error.retryAfterMs) : 0,
            Math.min(30000, 1000 * 2 ** this.failures[lineage]),
          );
        if (
          research ||
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
