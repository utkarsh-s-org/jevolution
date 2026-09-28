import { BASELINE_EXPERIMENTS, LIFE } from './experiments.js';
import type { Snapshot, World } from './types.js';

// Explicit model IDs only: aliases/custom models must not inherit an unrelated price.
export const PRICE_CATALOG = {
  'typesafe/jev-1.13.0': {
    input: 0.042,
    output: 0,
    checked: '2026-09-26',
    source: 'https://docs.typesafe.ai/models',
  },
  'anthropic/claude-haiku-4-5-20251001': {
    input: 1,
    output: 5,
    checked: '2026-09-26',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
} as const;

export function costBreakdown(world: World) {
  const groups = world.groups.map((g) => {
    const stats = world.stats[g.id];
    const price = PRICE_CATALOG[`${g.provider}/${g.model}` as keyof typeof PRICE_CATALOG];
    return {
      id: g.id,
      provider: g.provider,
      model: g.model,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      usd:
        g.controller === 'deterministic'
          ? 0
          : price
            ? (stats.inputTokens * price.input + stats.outputTokens * price.output) / 1e6
            : null,
      price: g.controller === 'deterministic' ? null : (price ?? null),
      // Conservative count, not an estimate of missing tokens or an invoice.
      potentiallyUnreportedCalls: stats.errors + stats.cancelled,
    };
  });
  return {
    groups,
    usd: groups.some((g) => g.usd === null) ? null : groups.reduce((sum, g) => sum + g.usd!, 0),
    knownSubtotalUsd: groups.reduce((sum, g) => sum + (g.usd ?? 0), 0),
    caveat:
      'List-price estimate for reported usage only. Interrupted/error calls may have unreported usage. No invoice, discounts, caching or infrastructure charges are inferred.',
  };
}

export function populationAccounting(world: World, initial?: World) {
  return world.groups.map((g) => {
    const wolf = g.species === 'wolf';
    const first = world.groups.find((other) => (other.species === 'wolf') === wolf);
    const immigrants =
      first?.id === g.id ? ((wolf ? world.migrants?.wolves : world.migrants?.rabbits) ?? 0) : 0;
    const count = (w: World) =>
      (wolf ? w.wolves : w.rabbits).filter((a) => a.lineage === g.id).length;
    const starting = initial ? count(initial) : (g.population ?? null);
    const stats = world.stats[g.id];
    const expected = starting === null ? null : starting + stats.births + immigrants - stats.deaths;
    return {
      id: g.id,
      label: g.label,
      initial: starting,
      initialSource: initial ? 'recorded initial world' : 'configured roster',
      births: stats.births,
      immigrants,
      deaths: stats.deaths,
      emigration: 0,
      living: count(world),
      expected,
      residual: expected === null ? null : count(world) - expected,
    };
  });
}

export function distribution(values: number[]) {
  if (!values.length) return { count: 0, median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

export function mechanismSummary(world: World) {
  const settings = world.experiments ?? BASELINE_EXPERIMENTS;
  const counters = world.mechanisms ?? {};
  const remaining = (world.carcasses ?? []).reduce((sum, c) => sum + c.energy, 0);
  const waterTiles = world.tiles.filter((tile) => tile.kind === 'water');
  return {
    settings,
    immigration: settings.demographics
      ? settings.immigration
      : world.scenario === 'predatorPrey'
        ? 'baseline continuous arrivals'
        : 'none',
    objective: settings.decisions ? settings.goal : 'original scenario prompt',
    demographics: settings.demographics
      ? world.groups.map((group) => {
          const wolf = group.species === 'wolf';
          const animals = (wolf ? world.wolves : world.rabbits).filter(
            (animal) => animal.lineage === group.id,
          );
          const life = LIFE[wolf ? 'wolf' : 'rabbit'];
          return {
            id: group.id,
            label: group.label,
            dependent: animals.filter((a) => (a.age ?? 0) < life.dependent).length,
            juveniles: animals.filter((a) => (a.age ?? 0) < life.maturity).length,
            adults: animals.filter((a) => (a.age ?? 0) >= life.maturity).length,
            pregnant: animals.filter((a) => a.life?.pregnancy).length,
          };
        })
      : null,
    resources: settings.resources
      ? {
          carcasses: world.carcasses?.length ?? 0,
          created: counters.carcassEnergyCreated ?? 0,
          eaten: counters.carcassEnergyEaten ?? 0,
          decayed: counters.carcassDecay ?? 0,
          remaining,
          residual:
            (counters.carcassEnergyCreated ?? 0) -
            (counters.carcassEnergyEaten ?? 0) -
            (counters.carcassDecay ?? 0) -
            remaining,
          waterRemaining: waterTiles.reduce((sum, tile) => sum + (tile.water ?? 100), 0),
          waterCapacity: waterTiles.length * 100,
          depletedWaterTiles: waterTiles.filter((tile) => (tile.water ?? 100) <= 0.01).length,
        }
      : null,
    counters,
  };
}

export function experimentReport(snapshot: Snapshot, initial?: World) {
  const { world, status } = snapshot;
  const requested = Object.values(world.stats).reduce((n, s) => n + s.requested, 0);
  const horizonReached = world.time >= status.config.maxSeconds;
  const requestCapReached = requested >= status.config.maxRequests;
  return {
    schemaVersion: 2,
    runId: status.runId,
    seed: world.seed,
    clock: status.clock ?? null,
    mechanisms: world.mechanisms ?? {},
    mechanismSummary: mechanismSummary(world),
    scenario: world.scenario ?? 'arena',
    simulationSeconds: world.time,
    targetSeconds: status.config.maxSeconds,
    horizonReached,
    requestCapReached,
    completion: status.running
      ? 'running'
      : horizonReached
        ? 'horizon reached'
        : requestCapReached
          ? 'request cap reached before horizon'
          : status.reason,
    horizonFraction: Math.min(1, world.time / status.config.maxSeconds),
    requested,
    config: status.config,
    population: populationAccounting(world, initial),
    cost: costBreakdown(world),
    groups: world.groups.map((g) => {
      const s = world.stats[g.id];
      return {
        id: g.id,
        model: g.model,
        requested: s.requested,
        applied: s.applied,
        late: s.late,
        invalid: s.invalid,
        errors: s.errors,
        cancelled: s.cancelled,
        apiRoundTripMs: distribution(s.latencies),
        queueSimulationMs: distribution(s.queueMs),
        queueWallMs: distribution(s.queueWallMs ?? []),
        queueWallEquivalentMs: distribution(
          status.config.experiments?.researchClock
            ? []
            : s.queueMs.map((v) => v / (status.config.timeScale ?? 1)),
        ),
      };
    }),
    caveats: [
      'Replay reconstructs recorded states; it is not a deterministic rerun of fresh model calls.',
      status.config.experiments?.researchClock
        ? 'Research queue and API latency use wall time. Biological time is frozen during requests; simulation queue is zero.'
        : 'Queue delay is recorded in simulated time; API latency is wall-clock time. Wall-equivalent queue is derived from time scale, not directly measured.',
      'A request-capped run is incomplete for a fixed-duration comparison.',
      'Population-accounting residuals flag missing/unmodeled changes rather than hiding them.',
      'Mechanism coefficients use illustrative simulation units, not field-calibrated species parameters.',
    ],
  };
}
