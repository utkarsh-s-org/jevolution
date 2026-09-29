// Opt-in predator–prey mechanisms: every switch off must match the original engine, and each
// switch must change only the mechanism it names. Model decisions here are fixtures, not results.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PREDATOR_PREY_GROUPS,
  PREDATOR_PREY_RULES as PP,
  PROVIDER_KEYS,
  SCENARIO_CONFIG,
} from './constants.js';
import { heardSignals, permuteChoices } from './decisionDynamics.js';
import { conceive, configureExperiments, finishGestations } from './demographics.js';
import {
  BASELINE_EXPERIMENTS,
  type Experiments,
  LIFE,
  validateExperiments,
} from './experiments.js';
import { protectedRabbit } from './habitat.js';
import { ProviderError } from './providerError.js';
import { SimulationRuntime } from './runtime.js';
import type { RuntimeServices } from './runtimePorts.js';
import { applyDecision, observe, stepWorld } from './simulation.js';
import type { Provider, Rabbit, World } from './types.js';
import { center, createWorld, walkable } from './world.js';

const make = (experiments?: Partial<Experiments>) => {
  const world = createWorld(42, PREDATOR_PREY_GROUPS, 'predatorPrey');
  if (experiments) configureExperiments(world, { ...BASELINE_EXPERIMENTS, ...experiments });
  return world;
};
const openGrass = (world: World) =>
  world.tiles.find((t) => t.kind === 'grass' && walkable(world, t) && t.x > 5 && t.y > 5)!;
const withoutSwitches = (world: World) => {
  const { experiments: _, ...rest } = structuredClone(world);
  return rest;
};
const run = (world: World, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) stepWorld(world, 0.05);
};
// A lone, fed, mature rabbit with no wolves or migrants to interfere.
const alone = (world: World) => {
  world.wolves = [];
  world.migrants = { wolves: 0, rabbits: 0, lastAt: 1e9 };
  const [r] = (world.rabbits = world.rabbits.slice(0, 1));
  Object.assign(r, center(openGrass(world)), {
    age: 60,
    cooldown: 0,
    energy: 90,
    water: 90,
    path: [],
    action: 'rest',
  });
  return r;
};

test('mechanism settings reject unknown switches and wrong types; absent means baseline', () => {
  assert.deepEqual(validateExperiments(undefined), BASELINE_EXPERIMENTS);
  assert.deepEqual(validateExperiments({ researchClock: true }), {
    ...BASELINE_EXPERIMENTS,
    researchClock: true,
  });
  assert.throws(() => validateExperiments({ teleport: true }), /Unknown mechanism/);
  assert.throws(() => validateExperiments({ demographics: 'yes' }), /Expected boolean/);
  assert.throws(() => validateExperiments({ goal: 'species' }), /Invalid objective/);
  assert.throws(() => validateExperiments({ immigration: 'open' }), /Invalid immigration/);
  assert.throws(() => validateExperiments([]), /Invalid mechanism/);
  assert.throws(() => configureExperiments({ ...make(), time: 1 }, BASELINE_EXPERIMENTS));
});

test('with every switch off, the world evolves exactly as the original engine', () => {
  const original = make();
  const baseline = make({});
  assert.deepEqual(observe(baseline, baseline.rabbits[0]), observe(original, original.rabbits[0]));
  // Past the first migration interval, so births, predation and arrivals are all exercised.
  run(original, PP.migrationInterval + 5);
  run(baseline, PP.migrationInterval + 5);
  assert.ok(original.stats.jev.births > 0);
  assert.deepEqual(withoutSwitches(baseline), withoutSwitches(original));
});

test('communication off rejects outgoing signals and hides signals already in the air', () => {
  const on = make({});
  const t = openGrass(on);
  const [a, b] = (on.rabbits = on.rabbits.slice(0, 2));
  Object.assign(a, center(t), { path: [], action: 'rest', energy: 90 });
  Object.assign(b, center({ x: t.x + 1, y: t.y }), { path: [], action: 'rest' });
  const choices = observe(on, a).choices;
  assert.ok(applyDecision(on, a, { choice: choices[0].id, signal: 'follow' }, choices));
  on.time += 1;
  assert.equal(heardSignals(on, b).length, 1);

  const off = make({ communication: false });
  const [c, d] = (off.rabbits = off.rabbits.slice(0, 2));
  Object.assign(c, center(t), { path: [], action: 'rest', energy: 90 });
  Object.assign(d, center({ x: t.x + 1, y: t.y }), { path: [], action: 'rest' });
  const offChoices = observe(off, c).choices;
  const reasons: string[] = [];
  assert.equal(
    applyDecision(off, c, { choice: offChoices[0].id, signal: 'follow' }, offChoices, (reason) =>
      reasons.push(reason),
    ),
    false,
  );
  assert.deepEqual(reasons, ['communication-disabled']);
  assert.ok(applyDecision(off, c, { choice: offChoices[0].id, signal: 'none' }, offChoices));
  off.signals = structuredClone(on.signals);
  off.time = on.time;
  assert.deepEqual(heardSignals(off, d), []);
  assert.deepEqual(observe(off, d).signals, []);
});

test('demographics: no solo births, and conception needs opposite-sex adults', () => {
  const solo = make({});
  alone(solo);
  run(solo, 30);
  assert.ok(solo.stats.jev.births > 0, 'the preset baseline breeds alone');

  const paired = make({ demographics: true });
  alone(paired);
  run(paired, 30);
  assert.equal(paired.stats.jev.births, 0);

  const world = make({ demographics: true });
  const [f, m, f2] = world.rabbits;
  for (const r of [f, m, f2]) r.energy = 90;
  f.life!.sex = 'female';
  f2.life!.sex = 'female';
  m.life!.sex = 'male';
  assert.equal(conceive(world, f, f2), false);
  assert.ok(conceive(world, f, m));
  assert.equal(f.life!.pregnancy!.due, world.time + LIFE.rabbit.gestation);
  assert.equal(conceive(world, f, m), false, 'a pregnant mother cannot conceive again');
});

test('demographics: a litter is born after gestation with two parents', () => {
  const world = make({ demographics: true });
  const [f, m] = world.rabbits;
  for (const r of [f, m]) r.energy = 90;
  f.life!.sex = 'female';
  m.life!.sex = 'male';
  const before = world.rabbits.length;
  assert.ok(conceive(world, f, m));
  finishGestations(world);
  assert.equal(world.rabbits.length, before, 'nothing is born before the due time');
  world.time = f.life!.pregnancy!.due;
  finishGestations(world);
  const litter = world.rabbits.slice(before);
  assert.equal(litter.length, LIFE.rabbit.litter);
  for (const child of litter) {
    assert.deepEqual(child.parents, [f.id, m.id]);
    assert.equal(child.energy, LIFE.rabbit.childEnergy);
  }
  assert.equal(f.life!.pregnancy, undefined);
});

test('demographics with closed immigration: no migrants arrive', () => {
  const closed = make({ demographics: true, immigration: 'closed' });
  const known = new Set([...closed.rabbits, ...closed.wolves].map((a) => a.id));
  closed.time = PP.migrationInterval + 1;
  stepWorld(closed, 0.05);
  const arrivals = [...closed.rabbits, ...closed.wolves].filter(
    (a) => !known.has(a.id) && (a.generation ?? 0) === 0,
  );
  assert.equal(arrivals.length, 0);
});

test('resources: a burrow protects only its first two occupants', () => {
  for (const resources of [false, true]) {
    const world = make({ resources });
    const shelter = world.tiles.find((t) => t.kind === 'shelter')!;
    const trio = (world.rabbits = world.rabbits.slice(0, 3));
    trio.forEach((r, i) =>
      Object.assign(r, center(shelter), {
        shelterKey: `${shelter.x},${shelter.y}`,
        shelterArrival: i + 1,
      }),
    );
    assert.deepEqual(
      trio.map((r) => protectedRabbit(world, r)),
      resources ? [true, true, false] : [true, true, true],
    );
  }
});

test('resources: a kill leaves a finite carcass instead of an instant meal', () => {
  const meal = (resources: boolean) => {
    const world = make({ resources });
    world.migrants = { wolves: 0, rabbits: 0, lastAt: 1e9 };
    const t = openGrass(world);
    const [w] = (world.wolves = world.wolves.slice(0, 1));
    const [r] = (world.rabbits = world.rabbits.slice(0, 1));
    Object.assign(w, center(t), { cooldown: 0, action: 'rest', path: [], target: undefined });
    Object.assign(r, center(t), { path: [], action: 'rest', energy: 80 });
    const before = w.energy!;
    stepWorld(world, 0.05);
    assert.equal(world.rabbits.length, 0);
    return { world, gain: w.energy! - before };
  };
  const instant = meal(false);
  assert.ok(instant.gain > 10);
  const finite = meal(true);
  assert.ok(finite.gain < 1, `wolf gained ${finite.gain} on the kill itself`);
  assert.equal(finite.world.carcasses!.length, 1);
  assert.ok(finite.world.carcasses![0].energy > 50 && finite.world.carcasses![0].energy <= 52);
});

test('decisions: menu shuffling is repeatable and never consumes ecological randomness', () => {
  const off = make({});
  const choices = observe(off, off.rabbits[0]).choices;
  assert.deepEqual(permuteChoices(off, off.rabbits[0], [...choices]), choices);

  const on = make({ decisions: true });
  const r = on.rabbits[0];
  const rng = on.rng;
  const first = permuteChoices(on, r, [...choices]).map((c) => c.id);
  assert.deepEqual(
    permuteChoices(on, r, [...choices]).map((c) => c.id),
    first,
  );
  assert.equal(on.rng, rng);
  assert.deepEqual([...first].sort(), choices.map((c) => c.id).sort());
});

// Research clock: fixture decisions returned in a scrambled order with varied delays.
function services(delay: (call: number) => number, fail?: (call: number) => boolean) {
  let ids = 0;
  let calls = 0;
  const records: Record<string, unknown>[] = [];
  const ready = Object.fromEntries(Object.keys(PROVIDER_KEYS).map((p) => [p, true])) as Record<
    Provider,
    boolean
  >;
  const s: RuntimeServices = {
    id: () => `id-${ids++}`,
    defaultGroups: () => PREDATOR_PREY_GROUPS,
    modelDefaults: { jev: 'fixture', claude: 'fixture' },
    providerReadiness: () => ready,
    choose: async (group, observation) => {
      const call = calls++;
      await new Promise((resolve) => setTimeout(resolve, delay(call)));
      if (fail?.(call)) throw new ProviderError('fixture failure', 500);
      return {
        // Rabbits also signal: signals share one list, so application order is observable.
        decision: {
          choice: observation.choices[0].id,
          signal: 'wolf' in observation ? 'none' : 'follow',
        },
        model: group.model,
        inputTokens: 10,
        outputTokens: 2,
        latencyMs: 100,
        requestId: null,
      };
    },
    createReplay: () => ({ frames: 0, capture() {}, flush() {}, get: () => ({}) as never }),
    record: (_, event) => records.push(event),
    saveInitial() {},
  };
  return { services: s, records, calls: () => calls };
}
const researchConfig = (overrides = {}) => ({
  ...SCENARIO_CONFIG.predatorPrey,
  maxInFlight: 40,
  maxSeconds: 6,
  experiments: { ...BASELINE_EXPERIMENTS, researchClock: true },
  ...overrides,
});
async function untilStopped(runtime: SimulationRuntime) {
  for (let waited = 0; runtime.running; waited += 20) {
    assert.ok(waited < 20000, 'research run did not finish');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('research clock: reply order and latency do not change the outcome', async () => {
  const worlds = [];
  for (const delay of [(c: number) => c % 7, (c: number) => 6 - (c % 7)]) {
    const fixture = services(delay);
    const runtime = new SimulationRuntime(fixture.services);
    try {
      runtime.reset(42, researchConfig());
      runtime.start();
      await untilStopped(runtime);
      assert.equal(runtime.world.time, 6);
      assert.ok(runtime.world.stats.jev.applied > 100);
      assert.ok(runtime.world.signals.length > 10);
      assert.deepEqual(
        fixture.records.filter((e) => e.type === 'research-round-start').map((e) => e.worldTime),
        [0, 2, 4],
      );
      const world = structuredClone(runtime.world);
      // Measured wall-clock waiting is the one thing expected to differ between runs.
      for (const stats of Object.values(world.stats)) delete stats.queueWallMs;
      worlds.push(world);
    } finally {
      runtime.dispose();
    }
  }
  assert.deepEqual(worlds[1], worlds[0]);
});

test('research clock: a request cap that cannot cover a full round stops before dispatch', async () => {
  const fixture = services(() => 0);
  const runtime = new SimulationRuntime(fixture.services);
  try {
    runtime.reset(42, researchConfig({ maxRequests: 10 }));
    runtime.start();
    await untilStopped(runtime);
    assert.match(runtime.reason, /cannot cover a complete decision round/);
    assert.equal(fixture.calls(), 0);
    assert.equal(runtime.world.time, 0);
  } finally {
    runtime.dispose();
  }
});

test('research clock: one failed call cancels the whole round; nothing is applied', async () => {
  const fixture = services(
    () => 2,
    (call) => call === 5,
  );
  const runtime = new SimulationRuntime(fixture.services);
  try {
    runtime.reset(42, researchConfig());
    const actions = (rabbits: Rabbit[]) => rabbits.map((r) => [r.id, r.action, r.path.length]);
    const before = actions(runtime.world.rabbits);
    runtime.start();
    await untilStopped(runtime);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(runtime.world.time, 0);
    assert.deepEqual(actions(runtime.world.rabbits), before);
    assert.equal(runtime.world.stats.jev.applied, 0);
    assert.ok(runtime.world.stats.jev.cancelled > 0);
  } finally {
    runtime.dispose();
  }
});
