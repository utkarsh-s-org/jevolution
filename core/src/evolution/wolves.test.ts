import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { choose, WOLF_INSTRUCTIONS } from '../../../server/src/evolution/models.js';
import { ArenaRuntime } from '../../../server/src/evolution/runtime.js';
import {
  balancePopulations,
  DEFAULT_CONFIG,
  DEFAULT_GROUPS,
  PROVIDER_KEYS,
  RULES,
  validateGroups,
} from './constants.js';
import { stepWorld } from './simulation.js';
import type { Provider } from './types.js';
import { applyWolfDecision, observeWolf, wolfSeesPrey } from './wolves.js';
import { createWolf, createWorld, tileAt } from './world.js';

function fixture(
  controller: 'model' | 'deterministic' = 'model',
  wolfLifeCycle: 'dynamic' | 'fixed' = 'fixed',
) {
  const world = createWorld(
    42,
    DEFAULT_GROUPS.map((g) => (g.species === 'wolf' ? { ...g, controller, wolfLifeCycle } : g)),
  );
  for (const t of world.tiles) Object.assign(t, { kind: 'grass', food: 0, foodCapacity: 0 });
  world.rabbits = world.rabbits.slice(0, 1);
  world.wolves = world.wolves.slice(0, 1);
  const wolf = world.wolves[0],
    rabbit = world.rabbits[0];
  Object.assign(wolf, { x: 10.5, y: 10.5, cooldown: 0, nextHunt: 0, path: [], action: 'rest' });
  Object.assign(rabbit, { x: 12.5, y: 10.5, energy: 100, water: 100, path: [], action: 'rest' });
  return { world, wolf, rabbit };
}
test('wolf groups split ten predators without reducing the rabbit budget; invalid species/controllers/counts fail', () => {
  const roster = balancePopulations([
    ...DEFAULT_GROUPS,
    { ...DEFAULT_GROUPS[2], id: 'pack-2', color: 3 },
  ]);
  const world = createWorld(42, roster);
  assert.equal(world.rabbits.length, 80);
  assert.equal(world.wolves.length, 10);
  assert.equal(world.wolves.filter((w) => w.lineage === 'wolves').length, 5);
  assert.equal(world.wolves.filter((w) => w.lineage === 'pack-2').length, 5);
  const adjusted = balancePopulations(roster, 'wolves', 3);
  assert.equal(adjusted.find((g) => g.id === 'pack-2')!.population, 7);
  assert.equal(adjusted.find((g) => g.id === 'jev')!.population, 40);
  const uneven = balancePopulations(adjusted, 'jev', 55);
  assert.equal(uneven.find((g) => g.id === 'wolves')!.population, 3);
  const changedWolves = balancePopulations(uneven, 'wolves', 2);
  assert.equal(changedWolves.find((g) => g.id === 'jev')!.population, 55);
  const removedWolf = balancePopulations(
    uneven.filter((g) => g.id !== 'pack-2'),
    undefined,
    undefined,
    'wolf',
  );
  assert.equal(removedWolf.find((g) => g.id === 'jev')!.population, 55);
  assert.equal(removedWolf.find((g) => g.id === 'wolves')!.population, 10);
  for (const bad of [
    [{ ...DEFAULT_GROUPS[0], controller: 'deterministic' }],
    [{ ...DEFAULT_GROUPS[0], species: 'bear' }],
    [{ ...DEFAULT_GROUPS[0], population: NaN }],
    [DEFAULT_GROUPS[0], { ...DEFAULT_GROUPS[2], population: 11 }],
    [DEFAULT_GROUPS[2]],
  ])
    assert.throws(() => validateGroups(bad));
  assert.deepEqual(createWorld(42, roster), world);
});
test('wolf observation excludes hidden, distant, and sheltered prey; cooldown offers no hunting', () => {
  const { world, wolf, rabbit } = fixture();
  assert.equal(observeWolf(world, wolf).prey.length, 1);
  tileAt(world, rabbit)!.kind = 'shelter';
  assert.equal(observeWolf(world, wolf).prey.length, 0);
  tileAt(world, rabbit)!.kind = 'forest';
  rabbit.action = 'hide';
  rabbit.x = 13.5;
  tileAt(world, rabbit)!.kind = 'forest';
  assert.equal(wolfSeesPrey(world, wolf, rabbit), false);
  rabbit.action = 'rest';
  tileAt(world, rabbit)!.kind = 'grass';
  tileAt(world, { x: 11.5, y: 10.5 })!.kind = 'mountain';
  assert.equal(wolfSeesPrey(world, wolf, rabbit), false);
  tileAt(world, { x: 11.5, y: 10.5 })!.kind = 'grass';
  rabbit.x = 25.5;
  assert.equal(observeWolf(world, wolf).prey.length, 0);
  rabbit.x = 12.5;
  wolf.cooldown = 5;
  assert.ok(observeWolf(world, wolf).choices.every((c) => c.action !== 'hunt'));
});
test('AI wolves only hunt an accepted visible target, stop tracking when hidden, and reject stale choices', () => {
  const { world, wolf, rabbit } = fixture();
  stepWorld(world, 0.05);
  assert.equal(wolf.target, undefined, 'no automatic target selection for AI wolves');
  const o = observeWolf(world, wolf),
    choice = `hunt_${rabbit.id}`;
  assert.ok(!applyWolfDecision(world, wolf, { choice, signal: 'danger' }, o.choices));
  assert.ok(applyWolfDecision(world, wolf, { choice, signal: 'none' }, o.choices));
  assert.equal(wolf.target, rabbit.id);
  rabbit.x = 45.5;
  stepWorld(world, 0.05);
  assert.equal(wolf.target, undefined);
  assert.equal(wolf.path.length, 0);
  assert.ok(!applyWolfDecision(world, wolf, { choice, signal: 'none' }, o.choices));
  rabbit.x = 12.5;
  wolf.cooldown = 4;
  assert.ok(!applyWolfDecision(world, wolf, { choice, signal: 'none' }, o.choices));
  wolf.cooldown = 0;
  world.rabbits = [];
  assert.ok(!applyWolfDecision(world, wolf, { choice, signal: 'none' }, o.choices));
});
test('both wolf controllers obey identical speed, capture, shelter, and eating cooldown mechanics', () => {
  const outcomes = [];
  for (const controller of ['model', 'deterministic'] as const) {
    const { world, wolf, rabbit } = fixture(controller);
    if (controller === 'model') {
      const o = observeWolf(world, wolf);
      assert.ok(
        applyWolfDecision(world, wolf, { choice: `hunt_${rabbit.id}`, signal: 'none' }, o.choices),
      );
    }
    stepWorld(world, 0.05);
    const moved = wolf.x - 10.5;
    rabbit.x = wolf.x + 0.1;
    stepWorld(world, 0.05);
    assert.equal(world.rabbits.length, 0);
    assert.equal(world.stats.wolves.kills, 1);
    assert.equal(wolf.cooldown, 18);
    outcomes.push({ moved, cooldown: wolf.cooldown });
    world.rabbits.push({ ...rabbit, id: 999, x: wolf.x, y: wolf.y, energy: 100 });
    stepWorld(world, 0.5);
    assert.equal(world.rabbits.length, 1, 'cannot eat during cooldown');
    wolf.cooldown = 0;
    tileAt(world, world.rabbits[0])!.kind = 'shelter';
    wolf.target = 999;
    wolf.path = [];
    stepWorld(world, 0.05);
    assert.equal(world.rabbits.length, 1, 'shelter excludes attacks');
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});
test('deterministic wolves repeat with the same seed and simulation steps', () => {
  const a = createWorld(58),
    b = createWorld(58);
  for (let i = 0; i < 100; i++) {
    stepWorld(a, 0.05);
    stepWorld(b, 0.05);
  }
  assert.deepEqual(a, b);
});
test('wolf adapters use species instructions and restrict signals across all four providers', async (t) => {
  const { world, wolf } = fixture();
  const o = observeWolf(world, wolf);
  for (const provider of Object.keys(PROVIDER_KEYS) as Provider[]) {
    const key = PROVIDER_KEYS[provider],
      previous = process.env[key];
    process.env[key] = 'fixture-key';
    let body: Record<string, unknown> = {};
    const decision = { choice: 'rest', signal: 'none' };
    const mock = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      const data =
        provider === 'typesafe'
          ? { answers: { action: { choice: 'rest' }, signal: { choice: 'none' } } }
          : provider === 'anthropic'
            ? { content: [{ type: 'tool_use', name: 'choose_action', input: decision }] }
            : provider === 'openai'
              ? {
                  output: [
                    {
                      type: 'function_call',
                      name: 'choose_action',
                      arguments: JSON.stringify(decision),
                    },
                  ],
                }
              : {
                  candidates: [
                    {
                      content: {
                        parts: [{ functionCall: { name: 'choose_action', args: decision } }],
                      },
                    },
                  ],
                };
      return new Response(JSON.stringify(data));
    });
    try {
      const result = await choose(
        { ...DEFAULT_GROUPS[2], controller: 'model', provider },
        o,
        new AbortController().signal,
      );
      assert.deepEqual(result.decision, decision);
      assert.ok(JSON.stringify(body).includes(WOLF_INSTRUCTIONS));
      assert.ok(!JSON.stringify(body).includes('Warn that danger'));
      const calls = mock.mock.callCount();
      await assert.rejects(
        choose(DEFAULT_GROUPS[2], o, new AbortController().signal),
        /do not use a model API/,
      );
      assert.equal(mock.mock.callCount(), calls);
    } finally {
      mock.mock.restore();
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});
test('runtime dispatches AI wolves, records their species, and never dispatches deterministic groups', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wolf-runtime-'));
  const old = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  let wolves = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.state.wolf) wolves++;
    return new Response(
      JSON.stringify({ answers: { action: { choice: 'rest' }, signal: { choice: 'none' } } }),
    );
  });
  const runtime = new ArenaRuntime(dir);
  try {
    const groups = balancePopulations([
      DEFAULT_GROUPS[0],
      DEFAULT_GROUPS[2],
      { ...DEFAULT_GROUPS[2], id: 'ai-wolves', controller: 'model', color: 3 },
    ]);
    runtime.reset(42, { ...DEFAULT_CONFIG, maxRequests: 8, maxInFlight: 1 }, groups);
    assert.equal(runtime.readiness().wolves, true);
    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    runtime.pause();
    assert.ok(wolves > 0);
    assert.equal(runtime.world.stats.wolves.requested, 0);
    assert.ok(runtime.world.stats['ai-wolves'].applied > 0);
    assert.ok(Object.values(runtime.world.stats).reduce((sum, s) => sum + s.requested, 0) <= 8);
    const lines = readFileSync(path.join(dir, `${runtime.runId}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.type === 'decision' && l.species === 'wolf' && l.animalId));
    const frame = runtime.replay.get(runtime.replay.frames - 1);
    assert.deepEqual(frame.world.groups, runtime.world.groups);
    assert.deepEqual(frame.world.wolves, JSON.parse(JSON.stringify(runtime.world.wolves)));
  } finally {
    runtime.dispose();
    mock.mock.restore();
    if (old === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dynamic wolves in either controller starve without prey; fixed wolves keep their population', () => {
  for (const controller of ['model', 'deterministic'] as const) {
    for (const lifeCycle of ['dynamic', 'fixed'] as const) {
      const { world, wolf } = fixture(controller, lifeCycle);
      world.rabbits = [];
      wolf.nextHunt = Infinity;
      const initialEnergy = wolf.energy;
      for (let i = 0; i < 2020; i++) stepWorld(world, 0.05);
      assert.equal(world.wolves.length, lifeCycle === 'dynamic' ? 0 : 1);
      assert.equal(world.stats.wolves.starvation, lifeCycle === 'dynamic' ? 1 : 0);
      assert.equal(world.stats.wolves.deaths, world.stats.wolves.starvation);
      if (lifeCycle === 'fixed') assert.equal(wolf.energy, initialEnergy);
    }
  }
  assert.throws(
    () =>
      validateGroups([
        { ...DEFAULT_GROUPS[0] },
        { ...DEFAULT_GROUPS[2], wolfLifeCycle: 'invalid' },
      ]),
    /life cycle/,
  );
});

test('a catch feeds a lone wolf but never produces an offspring', () => {
  for (const controller of ['model', 'deterministic'] as const) {
    const { world, wolf, rabbit } = fixture(controller, 'dynamic');
    Object.assign(wolf, { target: rabbit.id, action: 'hunt', nextHunt: Infinity });
    Object.assign(rabbit, { x: wolf.x + 0.2, y: wolf.y });
    stepWorld(world, 0.05);
    assert.equal(world.stats.wolves.kills, 1);
    assert.equal(world.stats.wolves.births, 0);
    assert.equal(world.wolves.length, 1);
    assert.equal(wolf.energy, 100);
    assert.equal(wolf.cooldown, 18);
  }
});
function matingFixture(controller: 'model' | 'deterministic' = 'model') {
  const { world, wolf } = fixture(controller, 'dynamic');
  world.rabbits = [];
  const mate = createWolf(world, wolf.lineage!, { x: 11, y: 10 });
  world.wolves.push(mate);
  for (const parent of [wolf, mate])
    Object.assign(parent, { energy: 100, cooldown: 0, age: 30, nextHunt: 0 });
  return { world, wolf, mate };
}
function chooseMate(
  world: ReturnType<typeof createWorld>,
  wolf: ReturnType<typeof createWolf>,
  id: number,
) {
  const obs = observeWolf(world, wolf);
  const choice = obs.choices.find((c) => c.mateId === id);
  assert.ok(choice, 'nearby eligible same-group mate is offered');
  assert.equal(
    applyWolfDecision(world, wolf, { choice: choice.id, signal: 'none' }, obs.choices),
    true,
  );
}
test('mutually chosen wolf pairs produce one pup and both pay costs; deterministic pairs use the same biology', () => {
  for (const controller of ['model', 'deterministic'] as const) {
    const { world, wolf, mate } = matingFixture(controller);
    mate.generation = 2;
    if (controller === 'model') {
      chooseMate(world, wolf, mate.id);
      assert.equal(
        observeWolf(world, mate).neighbors.find((n) => n.id === wolf.id)?.mateId,
        mate.id,
      );
      chooseMate(world, mate, wolf.id);
    }
    stepWorld(world, 0.05);
    assert.equal(world.stats.wolves.births, 1, controller);
    assert.equal(world.wolves.length, 3);
    const child = world.wolves[2];
    assert.deepEqual(child.parents, [wolf.id, mate.id]);
    assert.equal(child.lineage, wolf.lineage);
    assert.equal(child.generation, 3);
    assert.equal(child.age, 0, 'newborn is not aged during its birth step');
    assert.equal(child.energy, RULES.wolfChildEnergy);
    for (const parent of [wolf, mate]) {
      assert.ok(
        Math.abs(parent.energy! - (100 - RULES.wolfMetabolism * 0.05 - RULES.wolfBreedCost)) < 1e-9,
      );
      assert.equal(parent.reproductionCooldown, 45);
      assert.equal(parent.mateId, undefined);
      assert.equal(parent.action, 'rest');
    }
    stepWorld(world, 0.05);
    assert.equal(world.stats.wolves.births, 1, 'pair cannot double-count a birth');
  }
});
test('wolf mating requires two living, eligible, nearby same-group partners, mutual choices, space and cap room', () => {
  for (const blocked of [
    'young',
    'hungry',
    'cooldown',
    'other-group',
    'missing',
    'far',
    'one-sided',
    'occluded',
    'space',
    'cap',
    'old-age',
    'starvation',
  ] as const) {
    const { world, wolf, mate } = matingFixture();
    Object.assign(wolf, { action: 'mate', mateId: mate.id, nextHunt: Infinity });
    Object.assign(mate, { action: 'mate', mateId: wolf.id, nextHunt: Infinity });
    if (blocked === 'young') mate.age = 5;
    if (blocked === 'hungry') mate.energy = 94;
    if (blocked === 'cooldown') mate.reproductionCooldown = 10;
    if (blocked === 'other-group') mate.lineage = 'jev';
    if (blocked === 'missing') world.wolves = [wolf];
    if (blocked === 'far') mate.x = 15.5;
    if (blocked === 'one-sided') mate.action = 'rest';
    if (blocked === 'occluded') tileAt(world, mate)!.kind = 'mountain';
    if (blocked === 'space') {
      mate.x = wolf.x;
      for (const [x, y] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        tileAt(world, { x: wolf.x + x, y: wolf.y + y })!.kind = 'mountain';
    }
    if (blocked === 'cap')
      while (world.wolves.length < 32)
        world.wolves.push({ ...wolf, id: world.nextId++, energy: 50, action: 'rest' });
    if (blocked === 'old-age') mate.age = RULES.wolfLifespan;
    if (blocked === 'starvation') mate.energy = 0;
    stepWorld(world, 0.05);
    assert.equal(world.stats.wolves.births, 0, blocked);
    assert.ok(wolf.energy! > 99, `no birth cost for failed ${blocked} pairing`);
    if (blocked === 'old-age' || blocked === 'starvation') assert.equal(world.wolves.length, 1);
  }
});
test('wolf mate choices validate current state, stop tracking lost partners, and cancel on other actions', () => {
  const { world, wolf, mate } = matingFixture();
  const obs = observeWolf(world, wolf);
  const choice = obs.choices.find((c) => c.mateId === mate.id)!;
  mate.energy = 94;
  assert.equal(
    applyWolfDecision(world, wolf, { choice: choice.id, signal: 'none' }, obs.choices),
    false,
  );
  mate.energy = 100;
  chooseMate(world, wolf, mate.id);
  world.wolves = [wolf];
  stepWorld(world, 0.05);
  assert.equal(wolf.action, 'rest');
  assert.equal(wolf.mateId, undefined);
  assert.deepEqual(wolf.path, []);
  world.wolves.push(mate);
  chooseMate(world, wolf, mate.id);
  const next = observeWolf(world, wolf);
  assert.equal(
    applyWolfDecision(world, wolf, { choice: 'rest', signal: 'none' }, next.choices),
    true,
  );
  assert.equal(wolf.mateId, undefined);
  world.groups.find((g) => g.id === wolf.lineage)!.wolfLifeCycle = 'fixed';
  assert.ok(observeWolf(world, wolf).choices.every((c) => c.action !== 'mate'));
});
test('wolves track a moving chosen mate and do not reproduce until both are nearby', () => {
  const { world, wolf, mate } = matingFixture();
  mate.x = 13.5;
  chooseMate(world, wolf, mate.id);
  chooseMate(world, mate, wolf.id);
  stepWorld(world, 0.05);
  assert.equal(world.stats.wolves.births, 0);
  assert.ok(wolf.x > 10.5 && mate.x < 13.5);
  for (let i = 0; i < 30; i++) stepWorld(world, 0.05);
  assert.equal(world.stats.wolves.births, 1);
});

test('fixed life-cycle mode still catches prey without births or energy changes', () => {
  const { world, wolf, rabbit } = fixture('model', 'fixed');
  Object.assign(wolf, { target: rabbit.id, nextHunt: Infinity, energy: 100, age: 300 });
  Object.assign(rabbit, { x: wolf.x + 0.2, y: wolf.y });
  stepWorld(world, 0.05);
  assert.equal(world.stats.wolves.kills, 1);
  assert.equal(world.wolves.length, 1);
  assert.equal(world.stats.wolves.births, 0);
  assert.equal(wolf.energy, 100);
  assert.equal(observeWolf(world, wolf).wolf.energy, null);
});

test('prey extinction continues until dynamic wolves die, then stops even with fixed controls remaining', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wolf-extinction-'));
  const old = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  const mock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No model call expected');
  });
  const runtime = new ArenaRuntime(dir);
  try {
    runtime.reset(
      42,
      DEFAULT_CONFIG,
      balancePopulations([
        DEFAULT_GROUPS[0],
        DEFAULT_GROUPS[2],
        { ...DEFAULT_GROUPS[2], id: 'control', color: 3, wolfLifeCycle: 'fixed' },
      ]),
    );
    runtime.world.rabbits = [];
    for (const w of runtime.world.wolves) if (w.lineage === 'wolves') w.energy = 0.08;
    runtime.start();
    assert.equal(runtime.running, true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(runtime.running, false);
    assert.equal(runtime.world.stats.wolves.starvation, 5);
    assert.equal(runtime.world.wolves.length, 5);
    assert.equal(mock.mock.callCount(), 0);
    const frame = runtime.replay.get(runtime.replay.frames - 1);
    assert.equal(frame.world.stats.wolves.deaths, 5);
    assert.equal(frame.world.wolves.length, 5);
  } finally {
    runtime.dispose();
    mock.mock.restore();
    if (old === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a wolf death aborts its pending model call and records cancellation without provider errors', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wolf-cancel-'));
  const old = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-key';
  let calls = 0,
    aborted = 0;
  const mock = t.mock.method(
    globalThis,
    'fetch',
    (_url: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls++;
        init.signal!.addEventListener(
          'abort',
          () => {
            aborted++;
            reject(new Error('aborted'));
          },
          { once: true },
        );
      }),
  );
  const runtime = new ArenaRuntime(dir);
  try {
    runtime.reset(42, DEFAULT_CONFIG, [
      DEFAULT_GROUPS[0],
      { ...DEFAULT_GROUPS[2], controller: 'model' },
    ]);
    runtime.world.wolves = runtime.world.wolves.slice(0, 1);
    for (const r of runtime.world.rabbits) r.nextDecision = 10000;
    runtime.world.wolves[0].energy = 0.15;
    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(calls, 1);
    assert.equal(aborted, 1);
    assert.equal(runtime.world.wolves.length, 0);
    assert.equal(runtime.world.stats.wolves.cancelled, 1);
    assert.equal(runtime.world.stats.wolves.errors, 0);
    assert.equal(runtime.world.stats.wolves.applied, 0);
    assert.equal(runtime.status().inFlight.wolves, 0);
  } finally {
    runtime.dispose();
    mock.mock.restore();
    if (old === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
