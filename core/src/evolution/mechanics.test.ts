// Engine correctness checks, not model-quality evaluations or fabricated model responses.
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_GROUPS, GENE_NAMES, GRID, INITIAL_PER_LINEAGE, RULES } from './constants.js';
import { applyDecision, nearWater, observe, stepWorld } from './simulation.js';
import { isTerrainStamp, terrainStampIndices } from './terrain.js';
import {
  center,
  connectLand,
  createRabbit,
  createWorld,
  distance,
  findRoute,
  tileAt,
  visible,
  walkable,
} from './world.js';

test('seeded habitat is reproducible with matched founding genomes and random, unique spawns', () => {
  for (const seed of [1, 42, 271828, 8675309]) {
    const world = createWorld(seed);
    assert.deepEqual(world, createWorld(seed));
    assert.equal(world.rabbits.length, INITIAL_PER_LINEAGE * 2);
    assert.equal(world.wolves.length, RULES.wolfCount);
    assert.equal(world.tiles.filter((t) => t.kind === 'shelter').length, 6);
    for (let i = 0; i < world.rabbits.length; i += 2) {
      const a = world.rabbits[i];
      const b = world.rabbits[i + 1];
      assert.deepEqual(a.genes, b.genes);
      assert.equal(a.nextDecision, b.nextDecision);
      assert.ok(walkable(world, a) && walkable(world, b));
    }
    const animals = [...world.rabbits, ...world.wolves];
    assert.equal(new Set(animals.map((p) => `${p.x},${p.y}`)).size, animals.length);
    assert.ok(world.wolves.every((w) => walkable(world, w)));
    for (const rabbit of world.rabbits)
      assert.ok(world.wolves.every((w) => distance(rabbit, w) >= 6));
    for (const lineage of ['jev', 'claude'] as const) {
      const rabbits = world.rabbits.filter((r) => r.lineage === lineage);
      assert.equal(rabbits.length, INITIAL_PER_LINEAGE);
      // Catch a regression to separated teams on opposite sides of the map.
      assert.ok(rabbits.some((r) => r.x < GRID / 2));
      assert.ok(rabbits.some((r) => r.x > GRID / 2));
    }
  }
});

test('different seeds change geography, burrows and animal spawns without mirrored terrain', () => {
  const seeds = [1, 2, 3, 42, 271828, 8675309, 2147483647];
  const signatures = new Set<string>();
  const shelterLayouts = new Set<string>();
  const wolfLayouts = new Set<string>();
  for (const seed of seeds) {
    const world = createWorld(seed);
    signatures.add(world.tiles.map((t) => t.kind).join(','));
    shelterLayouts.add(
      JSON.stringify(world.tiles.filter((t) => t.kind === 'shelter').map((t) => [t.x, t.y])),
    );
    wolfLayouts.add(JSON.stringify(world.wolves.map((w) => [w.x, w.y])));
    for (const kind of ['water', 'forest', 'mountain'] as const) {
      const differingTiles = world.tiles.filter(
        (t) => (t.kind === kind) !== (world.tiles[t.y * GRID + GRID - 1 - t.x].kind === kind),
      );
      assert.ok(differingTiles.length > 20, `${kind} must not be mirrored for seed ${seed}`);
    }
  }
  assert.equal(signatures.size, seeds.length);
  assert.equal(shelterLayouts.size, seeds.length);
  assert.equal(wolfLayouts.size, seeds.length);
});

test('random maps keep all land connected, with water access and enough safe spawn sites across 200 seeds', () => {
  const seeds = [
    1,
    2,
    42,
    271828,
    2147483647,
    ...Array.from({ length: 195 }, (_, i) => 1 + (i + 1) * 104729),
  ];
  const edgeKinds = Array.from({ length: 4 }, () => new Set<string>());
  for (const seed of seeds) {
    const world = createWorld(seed);
    for (const tile of world.tiles) {
      if (isTerrainStamp(tile.kind))
        assert.ok(
          terrainStampIndices(tile).every((i) => world.tiles[i].kind === tile.kind),
          `partial ${tile.kind} at ${tile.x},${tile.y}, seed ${seed}`,
        );
      if (tile.x === 0) edgeKinds[0].add(tile.kind);
      if (tile.x === GRID - 1) edgeKinds[1].add(tile.kind);
      if (tile.y === 0) edgeKinds[2].add(tile.kind);
      if (tile.y === GRID - 1) edgeKinds[3].add(tile.kind);
    }
    const start = world.rabbits[0];
    const stack = [center(start)];
    const visited = new Set<number>();
    while (stack.length) {
      const p = stack.pop()!;
      const key = Math.floor(p.y) * GRID + Math.floor(p.x);
      if (visited.has(key)) continue;
      visited.add(key);
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const next = { x: p.x + dx, y: p.y + dy };
        if (walkable(world, next)) stack.push(next);
      }
    }
    assert.equal(
      visited.size,
      world.tiles.filter((t) => walkable(world, t)).length,
      `seed ${seed}`,
    );
    assert.ok(world.tiles.some((t) => walkable(world, t) && nearWater(world, center(t))));
    assert.equal(world.tiles.filter((t) => t.kind === 'shelter').length, 6);
    assert.equal(world.rabbits.length, 80);
    assert.equal(world.wolves.length, RULES.wolfCount);
    assert.equal(
      new Set([...world.rabbits, ...world.wolves].map((p) => `${p.x},${p.y}`)).size,
      80 + RULES.wolfCount,
    );
    assert.ok(
      world.rabbits.every(
        (r) => walkable(world, r) && world.wolves.every((w) => distance(r, w) >= 6),
      ),
    );
    const feedingGround = world.tiles.filter((t) => t.kind === 'grass' || t.kind === 'forest');
    const productive = feedingGround.filter((t) => t.foodCapacity > 0.5);
    assert.ok(productive.length > feedingGround.length * 0.1, `too little food at seed ${seed}`);
    assert.ok(
      productive.length < feedingGround.length * 0.7,
      `food should be patchy at seed ${seed}`,
    );
    for (const tile of world.tiles) {
      assert.ok(tile.food >= 0 && tile.food <= tile.foodCapacity);
      assert.ok(tile.foodCapacity <= RULES.foodCapacity);
      if (!['grass', 'forest'].includes(tile.kind)) assert.equal(tile.foodCapacity, 0);
    }
  }
  for (const kinds of edgeKinds)
    for (const kind of ['grass', 'forest', 'water', 'mountain'])
      assert.ok(kinds.has(kind), `${kind} should be able to reach every map edge`);
});

test('separated land is connected with a short passage, without deleting islands or wrapping map edges', () => {
  const world = createWorld(42);
  for (const tile of world.tiles) {
    const island =
      (tile.x <= 2 && tile.y >= 20 && tile.y <= 22) ||
      (tile.x >= GRID - 3 && tile.y >= 19 && tile.y <= 21);
    tile.kind = island ? 'forest' : 'water';
    tile.food = island ? 2 : 0;
    tile.elevation = 0;
  }
  connectLand(world);
  assert.equal(world.tiles.filter((t) => t.kind === 'forest').length, 18);
  assert.equal(world.tiles.filter((t) => t.kind === 'grass').length, 58);
  const route = findRoute(world, { x: 0, y: 20 }, { x: 63, y: 20 });
  assert.ok(route.length >= 63);
  let previous = center({ x: 0, y: 20 });
  for (const p of route) {
    assert.equal(distance(previous, p), 1);
    assert.ok(walkable(world, p));
    previous = p;
  }
  const connectedTiles = structuredClone(world.tiles);
  connectLand(world);
  assert.deepEqual(
    world.tiles,
    connectedTiles,
    'already connected terrain should remain unchanged',
  );
  assert.equal(walkable(world, { x: -1, y: 20 }), false);
  assert.equal(walkable(world, { x: GRID, y: 20 }), false);
});

test('rabbits can forage and drink on outermost tiles without targeting outside the map', () => {
  const world = createWorld(42);
  const rabbit = world.rabbits[0];
  for (const tile of world.tiles) {
    tile.kind = 'grass';
    tile.food = 0;
  }
  world.tiles[0].food = 8;
  world.tiles[1].kind = 'water';
  world.wolves = [];
  Object.assign(rabbit, center({ x: 0, y: 0 }));
  const observation = observe(world, rabbit);
  assert.ok(
    observation.choices.some(
      (c) => c.action === 'forage' && c.target?.x === 0.5 && c.target.y === 0.5,
    ),
  );
  assert.ok(
    observation.choices.some(
      (c) => c.action === 'drink' && c.target?.x === 0.5 && c.target.y === 0.5,
    ),
  );
  for (const choice of observation.choices)
    if (choice.target) assert.ok(walkable(world, choice.target));
});

test('all walkable habitat tiles are connected; legal routes never enter lakes or mountains', () => {
  const world = createWorld();
  const start = world.rabbits[0];
  const visited = new Set<number>();
  const stack = [center(start)];
  while (stack.length) {
    const p = stack.pop()!;
    const key = Math.floor(p.y) * GRID + Math.floor(p.x);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const next = { x: p.x + dx, y: p.y + dy };
      if (walkable(world, next)) stack.push(next);
    }
  }
  assert.equal(visited.size, world.tiles.filter((t) => walkable(world, t)).length);
  for (const rabbit of world.rabbits) {
    const route = findRoute(world, rabbit, world.rabbits.at(-1)!);
    let prior = center(rabbit);
    for (const p of route) {
      assert.ok(walkable(world, p));
      assert.equal(distance(prior, p), 1);
      prior = p;
    }
  }
  for (const t of world.tiles.filter((t) => t.kind === 'water').slice(0, 10))
    assert.deepEqual(findRoute(world, start, t), []);
});

test('real initial observations expose only visible neighbors and reachable action candidates', () => {
  const world = createWorld();
  for (const rabbit of world.rabbits) {
    const observation = observe(world, rabbit);
    assert.ok(observation.choices.length >= 2);
    assert.equal(new Set(observation.choices.map((c) => c.id)).size, observation.choices.length);
    for (const c of observation.choices) {
      if (c.target) {
        assert.ok(walkable(world, c.target));
        assert.ok(
          distance(rabbit, c.target) < 0.8 || findRoute(world, rabbit, c.target).length > 0,
        );
      }
      if (c.action === 'drink') assert.ok(nearWater(world, c.target!));
    }
    for (const n of observation.neighbors)
      assert.ok(visible(world, rabbit, n.position, 4 + Math.floor(rabbit.genes.vigilance * 6)));
  }
});

test('grass depletion, hydration, death accounting, and physical constraints hold during actual engine execution', () => {
  const world = createWorld(42);
  // Exercise a legal engine command from each rabbit's actual initial observation.
  // This is not a model response and is never labelled or recorded as Jev/Claude inference.
  for (const rabbit of world.rabbits) {
    const observation = observe(world, rabbit);
    const command =
      observation.choices.find((c) => c.action === 'forage') || observation.choices[0];
    assert.equal(
      applyDecision(world, rabbit, { choice: command.id, signal: 'none' }, observation.choices),
      true,
    );
  }
  for (let i = 0; i < 2000; i++) stepWorld(world, RULES.tickMs / 1000);
  for (const t of world.tiles) assert.ok(t.food >= 0 && t.food <= t.foodCapacity);
  for (const r of world.rabbits) {
    assert.ok(walkable(world, r));
    assert.ok(r.energy > 0 && r.energy <= 100);
    assert.ok(r.water > 0 && r.water <= 100);
    for (const gene of GENE_NAMES) assert.ok(r.genes[gene] >= 0.05 && r.genes[gene] <= 0.95);
  }
  for (const l of ['jev', 'claude'] as const) {
    const s = world.stats[l];
    assert.equal(
      INITIAL_PER_LINEAGE + s.births - s.deaths,
      world.rabbits.filter((r) => r.lineage === l).length,
    );
    assert.equal(s.deaths, s.predation + s.starvation + s.dehydration + s.oldAge);
    assert.equal(s.requested, 0);
    assert.equal(s.latencies.length, 0);
  }
});

test('two actual founders with reciprocal mating commands produce bounded inherited genes and parental costs', () => {
  const world = createWorld();
  const a = world.rabbits[0];
  const b = world.rabbits.find((r) => r.lineage === a.lineage && r.id !== a.id)!;
  // Unit-level setup exercises reproductive rule boundaries, not model performance.
  const p = world.tiles.find(
    (t) =>
      t.kind === 'grass' &&
      walkable(world, { x: t.x + 1, y: t.y }) &&
      !world.wolves.some((w) => distance(w, t) < 10),
  )!;
  Object.assign(a, center(p), { cooldown: 0, action: 'mate', mateId: b.id, energy: 90 });
  Object.assign(b, center({ x: p.x + 1, y: p.y }), {
    cooldown: 0,
    action: 'mate',
    mateId: a.id,
    energy: 90,
  });
  assert.ok(walkable(world, b));
  stepWorld(world, 0.05);
  const child = world.rabbits.find((r) => r.parents.includes(a.id) && r.parents.includes(b.id));
  assert.ok(child);
  assert.equal(child.lineage, a.lineage);
  assert.equal(child.generation, 1);
  assert.ok(a.energy < 70 && b.energy < 70);
  assert.ok(a.cooldown > 0 && b.cooldown > 0);
  for (const k of GENE_NAMES)
    assert.ok(Math.abs(child.genes[k] - (a.genes[k] + b.genes[k]) / 2) <= RULES.mutation + 1e-9);
  assert.equal(world.stats[a.lineage].births, 1);
  assert.equal(tileAt(world, child)?.kind === 'water', false);
});

test('food patches have distinct qualities and connected clusters, with no replenishment outside patches', () => {
  const world = createWorld(42);
  const fertile = world.tiles.filter((t) => t.foodCapacity > RULES.foodCapacity * 0.125);
  assert.ok(fertile.some((t) => t.foodCapacity > RULES.foodCapacity * 0.625));
  assert.ok(fertile.some((t) => t.foodCapacity < RULES.foodCapacity * 0.25));
  const clustered = fertile.filter((t) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => (tileAt(world, { x: t.x + dx, y: t.y + dy })?.foodCapacity || 0) > 1),
  );
  assert.ok(clustered.length > fertile.length * 0.9);
  const barren = world.tiles.filter(
    (t) => ['grass', 'forest'].includes(t.kind) && t.foodCapacity === 0,
  );
  assert.ok(barren.length > 500);
  world.rabbits = [];
  world.wolves = [];
  for (let i = 0; i < 60; i++) stepWorld(world, 10);
  assert.ok(barren.every((t) => t.food === 0));
  assert.ok(world.tiles.every((t) => t.food <= t.foodCapacity));
});

test('depleted patches refill gradually to their own capacity; drought slows growth and expiry restores it', () => {
  const normal = createWorld(42);
  normal.rabbits = [];
  normal.wolves = [];
  const rich = normal.tiles.find(
    (t) => t.kind === 'grass' && t.foodCapacity > RULES.foodCapacity * 0.625,
  )!;
  rich.food = 0;
  const dry = structuredClone(normal);
  dry.droughtUntil = 60;
  const index = rich.y * GRID + rich.x;
  stepWorld(normal, 10);
  stepWorld(dry, 10);
  assert.ok(rich.food > 0 && rich.food < rich.foodCapacity * 0.1);
  assert.ok(
    Math.abs(dry.tiles[index].food / rich.food - RULES.droughtRegrowth / RULES.foodRegrowth) < 1e-9,
  );
  dry.time = 60;
  const before = dry.tiles[index].food;
  stepWorld(dry, 10);
  assert.ok(Math.abs(dry.tiles[index].food - before - rich.food) < 1e-9);
  for (let i = 0; i < 60; i++) stepWorld(normal, 10);
  assert.equal(rich.food, rich.foodCapacity);
});

test('rabbits compete for one finite food supply, and depleted forage targets disappear', () => {
  const make = (count: number) => {
    const world = createWorld(42);
    const patch = world.tiles.find(
      (t) => t.kind === 'grass' && t.foodCapacity > RULES.foodCapacity * 0.625,
    )!;
    Object.assign(patch, { food: 4, foodCapacity: 8 });
    world.wolves = [];
    world.rabbits = world.rabbits.slice(0, count);
    for (const r of world.rabbits)
      Object.assign(r, center(patch), { action: 'forage', energy: 10, water: 100, path: [] });
    return { world, patch };
  };
  const single = make(1);
  const crowd = make(4);
  for (let i = 0; i < 20; i++) {
    stepWorld(single.world, 0.1);
    stepWorld(crowd.world, 0.1);
  }
  assert.ok(single.patch.food > 1);
  assert.ok(crowd.patch.food < 0.01);
  const consumed = crowd.world.stats.jev.food + crowd.world.stats.claude.food;
  const grown = (2 * RULES.foodRegrowth * crowd.patch.foodCapacity) / RULES.foodCapacity;
  assert.ok(Math.abs(consumed + crowd.patch.food - 4 - grown) < 1e-8);
  const observer = crowd.world.rabbits[0];
  assert.ok(
    !observe(crowd.world, observer).choices.some(
      (c) => c.action === 'forage' && c.target?.x === observer.x && c.target?.y === observer.y,
    ),
  );
});

function memoryHabitat() {
  const world = createWorld(42);
  for (const t of world.tiles) Object.assign(t, { kind: 'grass', food: 0, foodCapacity: 0 });
  const rabbit = world.rabbits[0];
  Object.assign(rabbit, { x: 10.5, y: 10.5, cooldown: 999 });
  world.rabbits = [rabbit];
  world.wolves = [];
  return { world, rabbit };
}

test('personal memory preserves old local sightings without revealing hidden changes', () => {
  const { world, rabbit } = memoryHabitat();
  Object.assign(tileAt(world, { x: 11, y: 10 })!, { food: 6, foodCapacity: 8 });
  tileAt(world, { x: 10, y: 12 })!.kind = 'water';
  world.wolves = [{ id: 999, x: 12.5, y: 10.5, path: [], cooldown: 100, nextHunt: 100, face: 1 }];
  const first = observe(world, rabbit);
  assert.ok(first.memory.some((m) => m.kind === 'food' && m.food === 6));
  assert.ok(first.memory.some((m) => m.kind === 'water'));
  assert.ok(first.memory.some((m) => m.kind === 'danger'));
  Object.assign(rabbit, { x: 30.5, y: 30.5 });
  tileAt(world, { x: 11, y: 10 })!.food = 0;
  world.wolves[0].x = 55.5;
  world.time = 10;
  const later = observe(world, rabbit);
  assert.equal(later.memory.find((m) => m.kind === 'food')!.food, 6);
  assert.equal(later.memory.find((m) => m.kind === 'food')!.age, 10);
  assert.equal(later.memory.find((m) => m.kind === 'danger')!.position.x, 12.5);
  const revisit = later.choices.find((c) => c.description.startsWith('Revisit remembered food'))!;
  assert.ok(revisit);
  assert.ok(applyDecision(world, rabbit, { choice: revisit.id, signal: 'none' }, later.choices));
  assert.equal(rabbit.action, 'explore'); // Depletion outside sight cannot reject a revisit.
  assert.equal(first.memory.find((m) => m.kind === 'food')!.age, 0);
  Object.assign(rabbit, { x: 10.5, y: 10.5 });
  assert.ok(!observe(world, rabbit).memory.some((m) => m.kind === 'food'));
});

test('memory expires by kind, is bounded, and is not shared or inherited', () => {
  const { world, rabbit } = memoryHabitat();
  const other = createRabbit(world, 'claude', { x: 50, y: 50 }, rabbit.genes);
  world.rabbits.push(other);
  for (const t of world.tiles) Object.assign(t, { food: 5, foodCapacity: 8 });
  observe(world, rabbit);
  assert.equal(rabbit.memory.filter((m) => m.kind === 'food').length, RULES.memoryLimit.food);
  assert.deepEqual(other.memory, []);
  const child = createRabbit(world, rabbit.lineage, rabbit, rabbit.genes, 1, [rabbit.id, other.id]);
  assert.deepEqual(child.memory, []);
  for (const t of world.tiles) t.food = 0;
  rabbit.memory = [
    { kind: 'food', position: { x: 50.5, y: 50.5 }, observedAt: 0, food: 4 },
    { kind: 'water', position: { x: 51.5, y: 50.5 }, observedAt: 0 },
    { kind: 'danger', position: { x: 52.5, y: 50.5 }, observedAt: 0, wolfId: 999 },
  ];
  world.time = 20;
  assert.deepEqual(
    observe(world, rabbit).memory.map((m) => m.kind),
    ['food', 'water'],
  );
  world.time = 120;
  assert.deepEqual(
    observe(world, rabbit).memory.map((m) => m.kind),
    ['water'],
  );
  world.time = 180;
  assert.deepEqual(observe(world, rabbit).memory, []);
});

test('signals identify senders but never create confirmed memories or force following', () => {
  const { world, rabbit } = memoryHabitat();
  const leader = createRabbit(world, 'claude', { x: 13, y: 10 }, rabbit.genes);
  world.rabbits.push(leader);
  world.signals.push({
    ...leader,
    sender: leader.id,
    kind: 'follow',
    delivered: 0.2,
    expires: 6,
    range: 8,
  });
  assert.equal(observe(world, rabbit).signals.length, 0);
  world.time = 1;
  const o = observe(world, rabbit);
  assert.equal(o.signals[0].sender, leader.id);
  assert.deepEqual(o.memory, []);
  assert.ok(o.choices.some((c) => c.followId === leader.id));
  applyDecision(world, rabbit, { choice: 'rest', signal: 'none' }, o.choices);
  stepWorld(world, 0.05);
  assert.equal(rabbit.action, 'rest');
  assert.equal(rabbit.followId, undefined);
  world.time = 6;
  assert.equal(observe(world, rabbit).signals.length, 0);
});

test('chosen following tracks visible movement, stops after lost sight, and can be cancelled', () => {
  const { world, rabbit } = memoryHabitat();
  const leader = createRabbit(world, 'claude', { x: 13, y: 10 }, rabbit.genes);
  leader.path = [{ x: 15.5, y: 10.5 }];
  world.rabbits.push(leader);
  const o = observe(world, rabbit);
  assert.equal(o.neighbors[0].moving, true);
  assert.deepEqual(o.neighbors[0].heading, { x: 1, y: 0 });
  assert.ok(!('target' in o.neighbors[0]));
  const follow = o.choices.find((c) => c.followId === leader.id)!;
  assert.ok(applyDecision(world, rabbit, { choice: follow.id, signal: 'none' }, o.choices));
  Object.assign(leader, { x: 14.5, y: 11.5, path: [] });
  stepWorld(world, 0.05);
  assert.deepEqual(rabbit.target, { x: 14.5, y: 11.5 });
  Object.assign(leader, { x: 50.5, y: 50.5 });
  stepWorld(world, 0.7);
  assert.equal(rabbit.action, 'rest');
  assert.deepEqual(rabbit.path, []);
  assert.equal(rabbit.followId, undefined);
  Object.assign(leader, { x: 13.5, y: 10.5, path: [{ x: 15.5, y: 10.5 }] });
  const next = observe(world, rabbit);
  const again = next.choices.find((c) => c.followId === leader.id)!;
  assert.ok(applyDecision(world, rabbit, { choice: again.id, signal: 'none' }, next.choices));
  assert.ok(applyDecision(world, rabbit, { choice: 'rest', signal: 'none' }, next.choices));
  assert.equal(rabbit.followId, undefined);
});

test('rabbits with no food die of starvation independently of wolf life cycles', () => {
  for (const wolfLifeCycle of ['dynamic', 'fixed'] as const) {
    const world = createWorld(
      42,
      DEFAULT_GROUPS.map((g) => (g.species === 'wolf' ? { ...g, wolfLifeCycle } : g)),
    );
    const rabbit = world.rabbits[0];
    world.rabbits = [rabbit];
    world.wolves = [];
    Object.assign(rabbit, { energy: 0.01, water: 100, age: 30, action: 'rest', path: [] });
    stepWorld(world, 1);
    assert.equal(world.rabbits.length, 0);
    assert.equal(world.stats[rabbit.lineage].starvation, 1);
    assert.equal(world.stats[rabbit.lineage].deaths, 1);
  }
});
