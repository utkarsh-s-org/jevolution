import {
  DEFAULT_SEED,
  PREDATOR_PREY_GROUPS,
  RULES,
  rulesFor,
  SCENARIO_CONFIG,
  validateGroups,
} from './constants.js';
import { DecisionJournal } from './decisions.js';
import { validateExperimentPreview } from './experimentPreview.js';
import { editWorldMap, validateMapEdits } from './mapEditor.js';
import { ProviderError } from './providerError.js';
import type {
  RuntimeBudget,
  RuntimeCoordination,
  RuntimeReplay,
  RuntimeServices,
} from './runtimePorts.js';
import { applyDecision, observe, stepWorld } from './simulation.js';
import type {
  DecisionTrace,
  Lineage,
  ModelGroup,
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
  config: RunConfig = { ...SCENARIO_CONFIG.predatorPrey };
  running = false;
  reason = 'Add your API keys, then start the ecosystem.';
  runId: string;
  connections = 0;
  decisions = new DecisionJournal();
  private epoch = 0;
  private coordinator?: RuntimeCoordination;
  private preparing?: Promise<void>;
  private budget?: RuntimeBudget;
  private budgetStopped = false;
  async prepare() {
    const mode = this.config.coordination || 'off';
    if (mode === 'off' || this.coordinator) return;
    if (this.preparing) return this.preparing;
    if (!this.services.createCoordination)
      throw new Error('Food coordination requires the local arena server.');
    if (this.config.scenario === 'predatorPrey')
      throw new Error('Food coordination requires the model arena scenario.');
    if (Object.values(this.readiness()).some((ready) => !ready))
      throw new Error('Configure the provider API keys before preparing agent services.');
    this.preparing = this.services
      .createCoordination({
        mode,
        runId: this.runId,
        world: () => this.world,
        record: (event) => this.record(event),
        onFailure: (message) => this.pause(message),
      })
      .then((coordinator) => {
        this.coordinator = coordinator;
        this.captureReplay();
      })
      .finally(() => {
        this.preparing = undefined;
      });
    return this.preparing;
  }
  async inspectTask(id: string) {
    if (!this.coordinator) throw new Error('Coordination is not enabled.');
    return this.coordinator.inspect(id);
  }
  private active = new Map<string, Pending>();
  private failures: Record<Lineage, number> = {};
  private backoff: Record<Lineage, number> = {};
  private tickTimer: ReturnType<typeof setInterval>;
  private lastTick = performance.now();
  private savedInitial = false;
  replay: RuntimeReplay;
  private services: RuntimeServices;
  constructor(services: RuntimeServices) {
    this.services = services;
    this.world = createWorld(
      DEFAULT_SEED,
      PREDATOR_PREY_GROUPS.map((g) => ({ ...g, model: services.jevModel?.() || g.model })),
      this.config.scenario,
    );
    this.budget = services.createBudget?.();
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
      if (!r.pending && (r.nextDecision ?? 0) <= this.world.time) backlog[r.lineage!]++;
    const a = this.world.stats;
    const knownPrice =
      this.world.groups.filter((g) => g.controller !== 'deterministic').length === 2 &&
      this.world.groups
        .filter((g) => g.controller !== 'deterministic')
        .every(
          (g) =>
            (g.id === 'jev' &&
              g.provider === 'typesafe' &&
              g.model === this.services.modelDefaults.jev) ||
            (g.id === 'claude' &&
              g.provider === 'anthropic' &&
              g.model === this.services.modelDefaults.claude),
        );
    return {
      running: this.running,
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
      budgetExposure: this.budget?.exposure,
      estimatedCost: this.budget
        ? this.budget.estimateCost(this.world)
        : this.world.scenario === 'predatorPrey'
          ? // Every predator–prey call is Jev (TypeSafe), priced like the arena's Jev group.
            (Object.values(a).reduce((sum, s) => sum + s.inputTokens, 0) * 0.042) / 1e6
          : knownPrice
            ? (a.jev.inputTokens * 0.042 + a.claude.inputTokens + a.claude.outputTokens * 5) / 1e6
            : null,
    };
  }
  snapshot(): Snapshot {
    return {
      world: this.world,
      status: this.status(),
      decisions: this.decisions.snapshot(),
      coordination: this.coordinator?.snapshot(),
    };
  }
  private record(event: Record<string, unknown>) {
    try {
      this.services.record(this.runId, {
        wallTime: new Date().toISOString(),
        runId: this.runId,
        simulationTime: this.world.time,
        ...event,
      });
    } catch {
      this.pause('Recording failed. Run stopped to avoid losing decision provenance.');
    }
  }
  start() {
    if (this.preparing) throw new Error('A2A services are still connecting.');
    if (this.config.coordination && this.config.coordination !== 'off' && !this.coordinator)
      throw new Error('Prepare coordination services before starting.');
    if (this.coordinator?.error) throw new Error(this.coordinator.error);
    if (this.budgetStopped)
      throw new Error('This run reached its dollar limit. Reset before running again.');
    if (this.config.maxCostUsd !== undefined) {
      if (!this.budget) throw new Error('Dollar limits require the local arena server.');
      this.budget.validate(this.world.groups);
    }
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
    this.reason = 'Live decisions · world continues during inference';
    this.failures = this.zeros();
    this.record({ type: 'start', config: this.config, groups: this.world.groups });
    this.captureReplay();
  }
  pause(reason = 'Paused. Pending decisions cancelled.') {
    this.running = false;
    this.reason = reason;
    this.epoch++;
    this.coordinator?.cancelAll(reason);
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
    if (this.preparing) throw new Error('Wait for coordination setup before resetting.');
    if (config.coordination && config.coordination !== 'off') {
      if (!this.services.createCoordination)
        throw new Error('Food coordination requires the local arena server.');
      if (config.scenario === 'predatorPrey')
        throw new Error('Food coordination requires the model arena scenario.');
    }
    if (config.maxCostUsd !== undefined && !this.services.createBudget)
      throw new Error('Dollar limits require the local arena server.');
    if (this.active.size)
      throw new Error('Pending calls are still cancelling. Try resetting in a moment.');
    // Predator–prey always runs its preset: Jev rabbits vs Jev wolves with a wolf life cycle.
    const predatorPrey = config.scenario === 'predatorPrey';
    const groups = predatorPrey
      ? PREDATOR_PREY_GROUPS.map((g) => ({ ...g, model: this.services.jevModel?.() || g.model }))
      : validateGroups(roster);
    this.pause();
    this.coordinator?.dispose();
    this.coordinator = undefined;
    this.budget = this.services.createBudget?.();
    this.budgetStopped = false;
    this.world = createWorld(seed, groups, config.scenario);
    this.config = { ...config, experimentPreview };
    this.runId = this.services.id();
    this.decisions.clear();
    this.replay = this.services.createReplay(this.runId);
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
    if (this.coordinator?.error) {
      this.pause(this.coordinator.error);
      return;
    }
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
    this.coordinator?.sync();
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
    if (!this.running) return;
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
    const queueMs = Math.max(0, (world.time - (rabbit.nextDecision ?? 0)) * 1000);
    const observation = 'genes' in rabbit ? observe(world, rabbit) : observeWolf(world, rabbit);
    if ('rabbit' in observation) this.coordinator?.augment(rabbit as Rabbit, observation);
    if (this.budget && !this.budget.reserve(id, group, observation, config.maxCostUsd)) {
      this.active.delete(id);
      rabbit.pending = false;
      this.budgetStopped = true;
      this.pause('Dollar limit reached (including reservations for in-flight calls).');
      return;
    }
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
      const result = await this.services.choose(group, observation, controller.signal, {
        relief: !!rulesFor(world).reliefEnabled,
        predatorPrey: world.scenario === 'predatorPrey',
        cooperation: !!this.coordinator,
      });
      this.budget?.settle(id, group, result);
      stats.inputTokens += result.inputTokens;
      stats.outputTokens += result.outputTokens;
      stats.latencies.push(result.latencyMs);
      rabbit.lastLatency = result.latencyMs;
      // Publish immediately on return, before artificial delay or equal-timing hold.
      publish({
        state: 'returned',
        controllerMs: performance.now() - started,
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
      const candidate =
        'rabbit' in observation
          ? observation.choices.find((c) => c.id === result.decision.choice)
          : undefined;
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
        'rabbit' in observation &&
        candidate &&
        !this.coordinatorValidate(rabbit as Rabbit, candidate)
      ) {
        stats.invalid++;
        outcome = 'invalid';
      } else if (
        !('wolf' in observation
          ? applyWolfDecision(world, rabbit as Wolf, result.decision, observation.choices)
          : applyDecision(world, rabbit as Rabbit, result.decision, observation.choices))
      ) {
        stats.invalid++;
        outcome = 'invalid';
      } else {
        stats.applied++;
        if ('rabbit' in observation && candidate) {
          const taskId = this.coordinator?.applied(rabbit as Rabbit, candidate, id);
          if (taskId) publish({ coordinationTaskId: taskId });
        }
      }
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
            // Honor a provider's Retry-After, but never stall a group for more than a few
            // seconds: an uncapped wait froze every wolf for the rest of a run.
            error instanceof ProviderError ? Math.min(RETRY_AFTER_CAP_MS, error.retryAfterMs) : 0,
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
  private coordinatorValidate(rabbit: Rabbit, candidate: import('./types.js').Candidate) {
    return this.coordinator?.validate(rabbit, candidate) ?? !candidate.coordination;
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
    this.coordinator?.dispose();
    clearInterval(this.tickTimer);
  }
}
