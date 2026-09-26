// Predator–prey preset: Jev rabbits vs Jev wolves on the shared wolf life cycle.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GRID, PREDATOR_PREY_GROUPS, PREDATOR_PREY_RULES as PP, RULES } from './constants.js';
import { stepWorld } from './simulation.js';
import { applyWolfDecision, observeWolf } from './wolves.js';
import { center, createWorld, distance, walkable } from './world.js';

const make = () => createWorld(42, PREDATOR_PREY_GROUPS, 'predatorPrey');
const openGrass = (world: ReturnType<typeof make>) =>
  world.tiles.find((t) => t.kind === 'grass' && walkable(world, t) && t.x > 5 && t.y > 5)!;
// Hold migration off so a check sees only the mechanic under test.
const noRescue = (world: ReturnType<typeof make>) =>
  (world.migrants = { wolves: 0, rabbits: 0, lastAt: 1e9 });

test('the preset starts 70 Jev rabbits and 8 Jev wolves with more burrows', () => {
  const world = make();
  assert.equal(world.scenario, 'predatorPrey');
  assert.equal(world.rabbits.length, 70);
  assert.equal(world.wolves.length, 8);
  assert.ok(world.wolves.every((w) => w.lineage === 'wolves' && w.energy === PP.wolfFounderEnergy));
  assert.equal(world.tiles.filter((t) => t.kind === 'shelter').length, PP.shelterCount);
  assert.equal(world.history[0].populations.wolves, 8);
  const arena = createWorld(42);
  assert.equal(arena.scenario, undefined);
  assert.equal(arena.tiles.filter((t) => t.kind === 'shelter').length, RULES.shelterCount);
});

test('wolves catch any exposed rabbit they reach, not only the one they chase', () => {
  const world = make();
  noRescue(world);
  const t = openGrass(world);
  const [w] = (world.wolves = world.wolves.slice(0, 1));
  const [r] = (world.rabbits = world.rabbits.slice(0, 1));
  Object.assign(w, center(t), { cooldown: 0, action: 'rest', path: [], target: undefined });
  Object.assign(r, center(t), { path: [], action: 'rest' });
  const before = w.energy!;
  stepWorld(world, 0.05);
  assert.equal(world.rabbits.length, 0);
  assert.equal(world.stats.jev.predation, 1);
  assert.ok(w.energy! > before);
});

test('a well-fed wolf has a pup right beside it; a hungry one does not', () => {
  const world = make();
  noRescue(world);
  world.rabbits = [];
  const t = openGrass(world);
  const [fed, hungry] = (world.wolves = world.wolves.slice(0, 2));
  Object.assign(fed, center(t), {
    energy: PP.wolfBreedEnergy + 10,
    reproductionCooldown: 0,
    action: 'rest',
  });
  Object.assign(hungry, center({ x: t.x + 10, y: t.y }), {
    energy: PP.wolfBreedEnergy - 20,
    reproductionCooldown: 0,
    action: 'rest',
  });
  stepWorld(world, 0.05);
  assert.equal(world.wolves.length, 3);
  assert.equal(world.stats.wolves.births, 1);
  const pup = world.wolves[2];
  assert.equal(pup.generation, 1);
  assert.deepEqual(pup.parents, [fed.id]);
  assert.ok(distance(pup, fed) <= 1.5);
  assert.ok(fed.energy! < PP.wolfBreedEnergy + 10 - PP.wolfBreedCost + 1);
});

test('mature rabbits close together breed without choosing to; the baby appears beside them', () => {
  // Crowding makes a birth attempt probabilistic, so check over many random draws.
  let births = 0;
  for (let draw = 1; draw <= 20; draw++) {
    const world = make();
    noRescue(world);
    world.wolves = [];
    const t = openGrass(world);
    const [a, b] = (world.rabbits = world.rabbits.slice(0, 2));
    Object.assign(a, center(t), { path: [], action: 'forage' });
    Object.assign(b, center({ x: t.x + 1, y: t.y }), { path: [], action: 'rest' });
    for (const r of [a, b]) Object.assign(r, { age: 60, cooldown: 0, energy: 90, water: 90 });
    world.rng = draw * 7919;
    stepWorld(world, 0.05);
    const child = world.rabbits.find((r) => r.generation > 0);
    if (!child) continue;
    births++;
    // Beside one parent, and close to the other.
    const [near, far] = [distance(child, a), distance(child, b)].sort((x, y) => x - y);
    assert.ok(near <= 1.5 && far <= 2.5);
  }
  assert.ok(births >= 14, `only ${births} of 20 pairs bred`);
});

test('crowding makes rabbit births fail more often near the capacity', () => {
  const births = (count: number) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const world = createWorld(seed, PREDATOR_PREY_GROUPS, 'predatorPrey');
      noRescue(world);
      world.wolves = [];
      const t = openGrass(world);
      const pair = world.rabbits.slice(0, 2);
      const filler = Array.from({ length: count - 2 }, (_, i) => ({
        ...world.rabbits[2 + (i % 40)],
        id: 10000 + i,
        age: 0,
        x: 0.5,
        y: 0.5,
      }));
      world.rabbits = [...pair, ...filler];
      Object.assign(pair[0], center(t), { path: [], action: 'rest' });
      Object.assign(pair[1], center({ x: t.x + 1, y: t.y }), { path: [], action: 'rest' });
      for (const r of pair) Object.assign(r, { age: 60, cooldown: 0, energy: 90, water: 90 });
      const before = world.stats.jev.births;
      stepWorld(world, 0.05);
      n += world.stats.jev.births - before;
    }
    return n;
  };
  assert.ok(births(10) > births(190) + 20);
});

test('migrants join on a steady timer, beside an animal of their own kind', () => {
  const world = make();
  const wolvesBefore = world.wolves.length,
    rabbitsBefore = world.rabbits.length;
  const known = new Set([...world.wolves, ...world.rabbits].map((a) => a.id));
  world.time = PP.migrationInterval + 1;
  stepWorld(world, 0.05);
  assert.equal(world.migrants?.wolves, PP.migrationWolves);
  assert.equal(world.migrants?.rabbits, PP.migrationRabbits);
  const newWolf = world.wolves.find((w) => !known.has(w.id))!;
  const newRabbits = world.rabbits.filter((r) => !known.has(r.id) && r.generation === 0);
  assert.ok(world.wolves.length >= wolvesBefore);
  assert.ok(world.rabbits.length >= rabbitsBefore);
  assert.ok(world.wolves.some((w) => w !== newWolf && distance(w, newWolf) <= 1.5));
  for (const r of newRabbits)
    assert.ok(world.rabbits.some((o) => o !== r && known.has(o.id) && distance(o, r) <= 1.5));
  // Nothing more until the next interval, however low the numbers.
  world.wolves = world.wolves.slice(0, 1);
  stepWorld(world, 0.05);
  assert.equal(world.migrants?.wolves, PP.migrationWolves);
});

test('with no wolves left, a migrant still arrives, from the map edge', () => {
  const world = make();
  world.wolves = [];
  world.time = PP.migrationInterval + 1;
  stepWorld(world, 0.05);
  const [w] = world.wolves;
  assert.ok(w.x < 4 || w.y < 4 || w.x > GRID - 4 || w.y > GRID - 4);
});

test('with scent on and no rabbit in sight, wolves are offered scent tracking first', (ctx) => {
  // The preset keeps scent off; turn it on for this check only.
  const saved = PP.wolfScent;
  (PP as { wolfScent: number }).wolfScent = 1;
  ctx.after(() => ((PP as { wolfScent: number }).wolfScent = saved));
  const world = make();
  noRescue(world);
  const t = openGrass(world);
  const [w] = (world.wolves = world.wolves.slice(0, 1));
  const [r] = (world.rabbits = world.rabbits.slice(0, 1));
  Object.assign(w, center(t));
  const far = world.tiles.find(
    (x) =>
      x.kind === 'grass' &&
      walkable(world, x) &&
      distance(x, t) > PP.wolfSight + 1 &&
      distance(x, t) < PP.wolfScentRange,
  )!;
  Object.assign(r, center(far), { path: [], action: 'rest' });
  const o = observeWolf(world, w);
  assert.equal(o.prey.length, 0);
  assert.equal(o.choices[0].id, 'track_scent');
  assert.ok(distance(o.choices[0].target!, r) < distance(w, r));
  assert.ok(!o.choices.some((c) => c.action === 'mate'));
  assert.ok(applyWolfDecision(world, w, { choice: 'track_scent', signal: 'none' }, o.choices));
});
