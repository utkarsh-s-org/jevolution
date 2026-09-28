import { GENE_NAMES, GRID, RULES as BASE_RULES, type Rules, rulesFor } from './constants.js';
import { heardSignals, permuteChoices } from './decisionDynamics.js';
import {
  boundaryMigration,
  careAndDisperse,
  compatible,
  conceive,
  dependent,
  finishGestations,
} from './demographics.js';
import {
  advanceHabitat,
  attemptedCatch,
  createCarcass,
  drink,
  feedWolf,
  protectedRabbit,
  shelterEntry,
  waterSource,
} from './habitat.js';
import {
  finishDrought,
  recordRelief,
  reliefChoices,
  stepRelief,
  validReliefChoice,
} from './relief.js';
import type {
  Candidate,
  Decision,
  Genes,
  Lineage,
  Memory,
  Observation,
  Point,
  Rabbit,
  Tile,
  Wolf,
  World,
} from './types.js';
import {
  ageWolf,
  availableWolfMates,
  finishWolfLife,
  reproduceWolves,
  wolfMate,
  wolfSeesPrey,
} from './wolves.js';
import {
  addEvent,
  cell,
  center,
  createRabbit,
  createWolf,
  directions,
  disperse,
  distance,
  findRoute,
  groupPopulation,
  random,
  tileAt,
  visible,
  walkable,
} from './world.js';

export const vision = (r: Rabbit) => 4 + Math.floor(r.genes.vigilance * 6);
export const mature = (r: Rabbit, RULES: Rules = BASE_RULES) =>
  !r.life?.pregnancy &&
  r.age >= RULES.maturity &&
  r.cooldown <= 0 &&
  r.energy >= RULES.breedEnergy &&
  r.water >= RULES.breedWater;
export function nearWater(world: World, p: Point): boolean {
  return !!waterSource(world, p);
}

function nearbyTiles(world: World, r: Rabbit) {
  const radius = vision(r);
  const c = cell(r);
  const tiles = [];
  for (let y = Math.max(0, c.y - radius); y <= Math.min(GRID - 1, c.y + radius); y++)
    for (let x = Math.max(0, c.x - radius); x <= Math.min(GRID - 1, c.x + radius); x++) {
      const t = tileAt(world, { x, y });
      if (t && walkable(world, t) && visible(world, r, center(t), radius)) tiles.push(t);
    }
  return tiles;
}
// Memory samples only what this rabbit sees at decision time. Never read unseen
// resource amounts or refresh an old sighting simply because it is remembered.
function remember(world: World, r: Rabbit, tiles: Tile[], wolves: Wolf[]) {
  const RULES = rulesFor(world);
  r.memory = r.memory.filter((m) => world.time - m.observedAt < RULES.memoryLife[m.kind]);
  const seen = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  r.memory = r.memory.filter((m) => {
    if (m.kind !== 'food') return true;
    const t = seen.get(`${Math.floor(m.position.x)},${Math.floor(m.position.y)}`);
    if (!t) return true;
    if (t.food <= 0.5) return false;
    m.food = t.food;
    m.observedAt = world.time;
    return true;
  });
  const save = (m: Memory) => {
    // Nearby resource tiles represent one location; danger tracks each seen wolf.
    r.memory = r.memory.filter(
      (old) =>
        old.kind !== m.kind ||
        (m.kind === 'danger' ? old.wolfId !== m.wolfId : distance(old.position, m.position) >= 3),
    );
    r.memory.push(m);
  };
  const food = [...tiles]
    .filter((t) => t.food > 0.5)
    .sort((a, b) => b.food / (1 + distance(r, b)) - a.food / (1 + distance(r, a)));
  const water = tiles
    .filter(
      (t) =>
        nearWater(world, t) &&
        [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ].some(([dx, dy]) => {
          const p = { x: t.x + dx, y: t.y + dy };
          return tileAt(world, p)?.kind === 'water' && visible(world, r, center(p), vision(r));
        }),
    )
    .sort((a, b) => distance(r, a) - distance(r, b));
  for (const [kind, candidates] of [
    ['food', food],
    ['water', water],
  ] as const) {
    const selected: Tile[] = [];
    for (const t of candidates) {
      if (selected.some((s) => distance(s, t) < 3)) continue;
      selected.push(t);
      save({
        kind,
        position: center(t),
        observedAt: world.time,
        ...(kind === 'food' ? { food: t.food } : {}),
      });
      if (selected.length >= RULES.memoryLimit[kind]) break;
    }
  }
  for (const w of wolves)
    save({ kind: 'danger', position: { x: w.x, y: w.y }, observedAt: world.time, wolfId: w.id });
  r.memory = (['food', 'water', 'danger'] as const).flatMap((kind) =>
    r.memory
      .filter((m) => m.kind === kind)
      .sort(
        (a, b) => b.observedAt - a.observedAt || distance(r, a.position) - distance(r, b.position),
      )
      .slice(0, RULES.memoryLimit[kind]),
  );
}
export function senseWorld(world: World) {
  if (!world.experiments?.decisions || world.time < (world.nextPerception ?? 0)) return;
  world.nextPerception = world.time + 0.5;
  for (const r of world.rabbits) {
    const tiles = nearbyTiles(world, r);
    r.knownTiles = [...new Set([...(r.knownTiles ?? []), ...tiles.map((t) => t.y * GRID + t.x)])];
    remember(
      world,
      r,
      tiles,
      world.wolves.filter((w) => visible(world, r, w, vision(r))),
    );
  }
  for (const w of world.wolves) {
    const seen = world.tiles.filter(
      (t) =>
        distance(t, w) <= rulesFor(world).wolfSight &&
        visible(world, w, center(t), rulesFor(world).wolfSight),
    );
    w.knownTiles = [...new Set([...(w.knownTiles ?? []), ...seen.map((t) => t.y * GRID + t.x)])];
  }
}
export function observe(world: World, r: Rabbit): Observation {
  const RULES = rulesFor(world);
  const radius = vision(r);
  const seenWolves = world.wolves.filter((w) => visible(world, r, w, radius));
  const wolves = seenWolves.map((w) => ({ x: w.x, y: w.y }));
  const neighbors = world.rabbits.filter((a) => a.id !== r.id && visible(world, r, a, radius));
  const tiles = nearbyTiles(world, r);
  if (!world.experiments?.decisions) remember(world, r, tiles, seenWolves);
  const choices: Candidate[] = [
    {
      id: 'rest',
      action: 'rest',
      description: 'Stop and conserve energy; resting does not create food energy.',
    },
  ];
  const add = (
    action: Candidate['action'],
    p: Point,
    description: string,
    mateId?: number,
    followId?: number,
  ) => {
    const dest = center(p);
    if (distance(r, dest) > 0.8 && !findRoute(world, r, dest).length) return;
    const id = `${action}_${Math.floor(dest.x)}_${Math.floor(dest.y)}${mateId || followId ? `_${mateId || followId}` : ''}`;
    if (choices.some((c) => c.id === id)) return;
    choices.push({
      id,
      action,
      target: dest,
      description,
      mateId,
      followId,
    });
  };
  // Listed first after rest: offspring are how a lineage grows.
  if (mature(r, RULES) && (!world.experiments?.decisions || !RULES.rabbitSoloBirths)) {
    const mates = neighbors
      .filter((a) => a.lineage === r.lineage && mature(a, RULES) && compatible(world, r, a))
      .sort((a, b) => distance(r, a) - distance(r, b))
      .slice(0, 2);
    for (const m of mates)
      add(
        'mate',
        m,
        world.experiments?.demographics
          ? `Approach compatible rabbit ${m.id}. Conception occurs when eligible adults meet within ${RULES.preyMateDistance} tiles; offspring arrive after gestation, costing parent energy.`
          : `Reproduce with rabbit ${m.id}: produces offspring that grow your lineage. Both of you are healthy and mature; rabbit ${m.id} must also choose to mate.`,
        m.id,
      );
  }
  const food = [...tiles]
    .filter((t) => t.food > 0.5)
    .sort((a, b) => b.food / (1 + distance(r, b)) - a.food / (1 + distance(r, a)))
    .slice(0, 2);
  for (const t of food)
    add(
      'forage',
      t,
      `Forage at (${t.x},${t.y}). Food ${t.food.toFixed(1)} of ${t.foodCapacity.toFixed(1)} capacity; distance ${distance(r, t).toFixed(1)}. Nearby rabbits share and deplete this supply; regrowth is slow.`,
    );
  const water = [...tiles]
    .filter((t) => nearWater(world, t))
    .sort((a, b) => distance(r, a) - distance(r, b))
    .slice(0, 1);
  for (const t of water)
    add('drink', t, `Walk to this lake shore and drink. Distance ${distance(r, t).toFixed(1)}.`);
  for (const kind of ['food', 'water'] as const) {
    const remembered = r.memory
      .filter((m) => m.kind === kind && !visible(world, r, m.position, radius))
      .sort((a, b) => distance(r, a.position) - distance(r, b.position))
      .slice(0, 2);
    for (const m of remembered)
      add(
        'explore',
        m.position,
        `Revisit remembered ${kind} at (${Math.floor(m.position.x)},${Math.floor(m.position.y)}), last seen ${(world.time - m.observedAt).toFixed(1)} seconds ago.${kind === 'food' ? ` Had ${m.food!.toFixed(1)} food then; it may now be depleted.` : ''} Move there to inspect; choose foraging or drinking after seeing it again.`,
      );
  }
  const cover = tiles
    .filter((t) => t.kind === 'shelter' || t.kind === 'forest')
    .sort((a, b) => distance(r, a) - distance(r, b))
    .slice(0, 2);
  // Cover is only offered while a wolf is in sight; hiding ends when none is.
  for (const t of wolves.length ? cover : [])
    add(
      'hide',
      t,
      `Hide in ${t.kind}. ${world.experiments?.resources ? 'Burrows protect only the first two occupants; overflow remains exposed' : 'Shelters exclude attacks'}; forest reduces wolf detection to 2 tiles while hiding. Distance ${distance(r, t).toFixed(1)}.`,
    );
  for (const [dx, dy, direction] of directions(world)) {
    const targets = tiles.filter((t) => (dx ? (t.x - r.x) * dx > 2 : (t.y - r.y) * dy > 2));
    const target = targets.sort(
      (a, b) =>
        distance(a, { x: r.x + dx * 5, y: r.y + dy * 5 }) -
        distance(b, { x: r.x + dx * 5, y: r.y + dy * 5 }),
    )[0];
    if (target)
      add(
        wolves.length ? 'flee' : 'explore',
        target,
        `Move ${direction}. ${wolves.length ? `Closest visible wolf to destination: ${Math.min(...wolves.map((w) => distance(w, target))).toFixed(1)} tiles.` : 'Find new food, water, or mates beyond current visibility.'}`,
      );
  }
  const signals = heardSignals(world, r);
  const leaders = neighbors
    .filter((n) => n.path.length || signals.some((s) => s.sender === n.id && s.kind === 'follow'))
    .sort((a, b) => distance(r, a) - distance(r, b))
    .slice(0, 2);
  for (const leader of leaders)
    add(
      'follow',
      leader,
      `Follow visible rabbit ${leader.id} (${leader.lineage === r.lineage ? 'same' : 'other'} lineage). Track it only while visible. Following and signals are optional.`,
      undefined,
      leader.id,
    );
  if (RULES.reliefEnabled) choices.push(...reliefChoices(world, r, neighbors, tiles, radius));
  return {
    caches: world.caches.filter((c) => visible(world, r, c, radius)),
    rabbit: {
      ...(world.experiments?.decisions && r.life
        ? { sex: r.life.sex, pregnancyDue: r.life.pregnancy?.due }
        : {}),
      id: r.id,
      age: r.age,
      generation: r.generation,
      energy: r.energy,
      cargo: r.cargo,
      water: r.water,
      genes: { ...r.genes },
      position: { x: r.x, y: r.y },
    },
    environment: {
      time: world.time,
      drought: world.droughtUntil > world.time,
      tile: tileAt(world, r)!.kind,
      grass: tileAt(world, r)!.food,
    },
    wolves,
    neighbors: neighbors.map((n) => ({
      id: n.id,
      ally: n.lineage === r.lineage,
      position: { x: n.x, y: n.y },
      energy: world.experiments?.decisions ? Math.round(n.energy / 25) * 25 : n.energy,
      cargo: world.experiments?.decisions ? (n.cargo > 0 ? 1 : 0) : n.cargo,
      needsFood: world.experiments?.decisions ? n.energy < 25 : n.energy < RULES.hungryEnergy,
      action: n.action,
      moving: n.path.length > 0,
      heading: n.path.length
        ? { x: Math.sign(n.path[0].x - n.x), y: Math.sign(n.path[0].y - n.y) }
        : null,
    })),
    signals,
    memory: r.memory.map(({ kind, position, observedAt, food }) => ({
      kind,
      position: { ...position },
      age: world.time - observedAt,
      ...(food === undefined ? {} : { food }),
    })),
    choices: permuteChoices(world, r, choices),
  };
}
export function applyDecision(
  world: World,
  r: Rabbit,
  decision: Decision,
  choices: Candidate[],
  onReject?: (reason: string) => void,
): boolean {
  const reject = (reason: string) => {
    onReject?.(reason);
    return false;
  };
  const RULES = rulesFor(world);
  const chosen = choices.find((c) => c.id === decision.choice);
  if (world.experiments?.communication === false && decision.signal !== 'none')
    return reject('communication-disabled');
  if (!chosen || !['none', 'danger', 'food', 'follow', 'help'].includes(decision.signal))
    return reject('choice-or-signal-invalid');
  if (
    chosen.action === 'mate' &&
    (!mature(r, RULES) ||
      !world.rabbits.some(
        (a) =>
          a.id === chosen.mateId &&
          a.lineage === r.lineage &&
          mature(a, RULES) &&
          compatible(world, r, a),
      ))
  )
    return reject('mate-no-longer-eligible');
  if (
    chosen.action === 'follow' &&
    !world.rabbits.some((n) => n.id === chosen.followId && visible(world, r, n, vision(r)))
  )
    return reject('leader-not-visible');
  if (!validReliefChoice(world, r, chosen, vision(r)))
    return reject('relief-target-no-longer-valid');
  if (chosen.target && !walkable(world, chosen.target)) return reject('target-not-walkable');
  if (
    (chosen.action === 'forage' || chosen.action === 'collect') &&
    (tileAt(world, chosen.target!)?.food ?? 0) < 0.1
  )
    return reject('food-depleted');
  if (chosen.action === 'drink' && !nearWater(world, chosen.target!))
    return reject('water-unavailable');
  const route = chosen.target ? findRoute(world, r, chosen.target) : [];
  if (chosen.target && distance(r, chosen.target) > 0.8 && !route.length)
    return reject('route-unavailable');
  if (choices.some((c) => c.action === 'follow')) {
    for (const behavior of [r.behavior, world.stats[r.lineage].behavior]) {
      behavior.offered++;
      if (chosen.action === 'follow') behavior.followed++;
      else behavior.other++;
    }
  }
  r.action = chosen.action;
  if (world.experiments?.decisions) r.committedUntil = world.time + 2;
  r.target = chosen.target;
  r.path = route;
  r.mateId = chosen.mateId;
  r.followId = chosen.followId;
  r.recipientId = chosen.recipientId;
  r.nextFollow = world.time;
  r.forageUntil = undefined;
  if (r.path.length && distance(r, center(r)) > 0.05) r.path.unshift(center(r));
  if (
    decision.signal !== 'none' &&
    r.energy > 2 &&
    (decision.signal !== 'help' ||
      (r.energy < RULES.hungryEnergy && world.time >= r.nextHelpSignal))
  ) {
    if (decision.signal === 'help') {
      r.helpRequestedAt ??= world.time;
      r.nextHelpSignal = world.time + RULES.helpCooldown;
      recordRelief(world, r, {
        kind: 'help',
        amount: 0,
        from: { x: r.x, y: r.y },
        to: { x: r.x, y: r.y },
      });
    }
    r.energy -= RULES.signalCost * (1 + r.genes.sociability);
    r.lastSignal = decision.signal;
    r.signalUntil = world.time + RULES.signalLife;
    world.signals.push({
      ...(world.experiments?.decisions ? { messageId: `${r.id}:${world.time.toFixed(6)}` } : {}),
      x: r.x,
      y: r.y,
      sender: r.id,
      lineage: r.lineage,
      kind: decision.signal,
      delivered: world.time + RULES.signalDelay,
      expires: world.time + RULES.signalLife,
      range: 3 + r.genes.sociability * 5,
    });
    world.signals = world.signals.slice(-RULES.maxSignalHistory);
    world.stats[r.lineage].signals++;
  }
  return true;
}
function move(entity: Point & { path: Point[]; face: number }, speed: number, dt: number): number {
  let budget = speed * dt;
  let moved = 0;
  while (budget > 0 && entity.path.length) {
    const target = entity.path[0];
    const d = distance(entity, target);
    if (d < 0.001) {
      entity.path.shift();
      continue;
    }
    const amount = Math.min(d, budget);
    if (Math.abs(target.x - entity.x) > 0.01) entity.face = target.x > entity.x ? 1 : -1;
    entity.x += ((target.x - entity.x) / d) * amount;
    entity.y += ((target.y - entity.y) / d) * amount;
    moved += amount;
    budget -= amount;
    if (amount >= d) entity.path.shift();
  }
  return moved;
}
function kill(
  world: World,
  r: Rabbit,
  cause: 'predation' | 'starvation' | 'dehydration' | 'oldAge',
) {
  world.rabbits = world.rabbits.filter((a) => a.id !== r.id);
  world.stats[r.lineage].deaths++;
  world.stats[r.lineage][cause]++;
  addEvent(
    world,
    'death',
    `Rabbit #${r.id} · ${cause === 'oldAge' ? 'old age' : cause} · generation ${r.generation}`,
    r.lineage,
  );
}
function reproduce(world: World, a: Rabbit, b: Rabbit) {
  if (!compatible(world, a, b)) return;
  const RULES = rulesFor(world);
  if (world.rabbits.length >= RULES.maxPopulation) return;
  // Crowding makes each birth attempt less likely to succeed (logistic growth), so rabbits level
  // off below the hard cap instead of pinning at it. A failed attempt still waits a cooldown.
  const crowded = Math.max(
    RULES.rabbitCapacity ? world.rabbits.length / RULES.rabbitCapacity : 0,
    RULES.localCapacity
      ? world.rabbits.filter((r) => distance(r, a) <= RULES.localCrowdRadius).length /
          RULES.localCapacity
      : 0,
  );
  if (crowded && random(world) < crowded) {
    for (const r of new Set([a, b]))
      r.cooldown = RULES.breedCooldown * (1.3 - 0.6 * r.genes.fertility);
    return;
  }
  if (world.experiments?.demographics) {
    conceive(world, a, b);
    return;
  }
  const free = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([x, y]) => center({ x: a.x + x, y: a.y + y }))
    .find((p) => walkable(world, p) && !world.rabbits.some((r) => distance(r, p) < 0.5));
  if (!free) return;
  const genes = Object.fromEntries(
    GENE_NAMES.map((k) => [
      k,
      Math.max(
        0.05,
        Math.min(0.95, (a.genes[k] + b.genes[k]) / 2 + (random(world) - 0.5) * 2 * RULES.mutation),
      ),
    ]),
  ) as Genes;
  const child = createRabbit(
    world,
    a.lineage,
    free,
    genes,
    Math.max(a.generation, b.generation) + 1,
    [a.id, b.id],
  );
  child.nextDecision = world.time;
  disperse(world, child);
  world.rabbits.push(child);
  world.stats[a.lineage].births++;
  for (const r of new Set([a, b])) {
    r.energy -= RULES.breedCost + r.genes.fertility * 12;
    r.cooldown = RULES.breedCooldown * (1.3 - 0.6 * r.genes.fertility);
    r.action = 'rest';
    r.path = [];
  }
  addEvent(
    world,
    'birth',
    `Rabbit #${child.id} born · generation ${child.generation} · parents #${a.id} + #${b.id}`,
    a.lineage,
  );
}
export function stepWorld(world: World, dt: number) {
  const RULES = rulesFor(world);
  world.time += dt;
  advanceHabitat(world, dt);
  senseWorld(world);
  const drought = world.time < world.droughtUntil;
  for (const t of world.tiles)
    if (t.kind === 'grass' || t.kind === 'forest') {
      if (drought && t.kind === 'grass' && !nearWater(world, center(t)))
        t.food = Math.max(0, t.food - dt * RULES.droughtWither);
      t.food = Math.min(
        t.foodCapacity,
        t.food +
          dt *
            (t.foodCapacity / RULES.foodCapacity) *
            (drought ? RULES.droughtRegrowth : RULES.foodRegrowth),
      );
    }
  world.signals = world.signals.filter((s) => s.expires > world.time);
  // Rotate the update order, so a fixed ID or lineage never wins every resource tie.
  const rabbits = [...world.rabbits];
  const offset = rabbits.length ? Math.floor(random(world) * rabbits.length) : 0;
  const ordered = [...rabbits.slice(offset), ...rabbits.slice(0, offset)];
  for (const r of ordered) {
    r.age += dt;
    r.cooldown -= dt;
    careAndDisperse(world, r, dt);
    const basal =
      RULES.baseMetabolism +
      r.genes.vigilance * RULES.visionMetabolism +
      r.genes.speed * RULES.speedMetabolism -
      r.genes.thrift * 0.035;
    r.energy -= dt * basal * (r.action === 'rest' ? RULES.restMetabolism : 1);
    r.water -= dt * (drought ? RULES.droughtThirst : RULES.thirst);
    const terrain = tileAt(world, r)!;
    const speed =
      (RULES.baseSpeed + r.genes.speed * RULES.speedGain - r.genes.thrift * 0.16) *
      (terrain.kind === 'forest' ? RULES.forestSpeed : 1);
    if ((r.action === 'follow' || r.action === 'share') && world.time >= r.nextFollow) {
      r.nextFollow = world.time + RULES.followReplan;
      const leader = world.rabbits.find(
        (n) => n.id === (r.action === 'share' ? r.recipientId : r.followId),
      );
      if (
        !leader ||
        !visible(world, r, leader, vision(r)) ||
        (r.action === 'share' && (leader.energy >= RULES.hungryEnergy || r.cargo <= 0.1))
      ) {
        r.action = 'rest';
        r.path = [];
        r.target = undefined;
        r.followId = undefined;
        r.recipientId = undefined;
      } else {
        r.target = center(leader);
        r.path = distance(r, leader) <= 1.5 ? [] : findRoute(world, r, leader);
        if (r.path.length && distance(r, center(r)) > 0.05) r.path.unshift(center(r));
      }
    }
    // Hiding ends once no wolf is in sight; the rabbit rests and decides again right away.
    if (r.action === 'hide' && !world.wolves.some((w) => visible(world, r, w, vision(r)))) {
      r.action = 'rest';
      r.path = [];
      r.target = undefined;
      if (!r.pending) r.nextDecision = Math.min(r.nextDecision, world.time);
    }
    const juvenile = world.experiments?.demographics && r.age < RULES.maturity;
    const moved = move(r, dependent(world, r) ? 0 : speed * (juvenile ? 0.65 : 1), dt);
    r.energy -= moved * (RULES.movementCost + r.genes.speed * 0.14);
    if (world.experiments?.resources) shelterEntry(world, r);
    if (!r.path.length) {
      const t = tileAt(world, r)!;
      stepRelief(world, r, t, dt);
      // A foraging bout lasts forageBout seconds; then the rabbit must decide again.
      if (r.action === 'forage') {
        r.forageUntil ??= world.time + RULES.forageBout;
        if (world.time >= r.forageUntil) {
          r.action = 'rest';
          r.forageUntil = undefined;
          if (!r.pending) r.nextDecision = Math.min(r.nextDecision, world.time);
        }
      }
      if (r.action === 'forage' && t.food > 0 && r.energy < 100) {
        const bite = Math.min(
          t.food,
          dt * RULES.eatRate * (1 - r.genes.thrift * 0.3),
          (100 - r.energy) / RULES.foodEnergy,
        );
        t.food -= bite;
        r.energy += bite * RULES.foodEnergy;
        world.stats[r.lineage].food += bite;
      }
      if (r.action === 'drink' && nearWater(world, r)) drink(world, r, dt * RULES.drinkRate);
      // Predator–prey: births are a population rate — any mature pair close together breeds.
      const passive = !!RULES.passiveBreeding;
      if ((r.action === 'mate' || passive) && mature(r, RULES)) {
        const mate = RULES.rabbitSoloBirths
          ? r
          : world.rabbits.find(
              (b) =>
                b.id !== r.id &&
                b.lineage === r.lineage &&
                compatible(world, r, b) &&
                (passive || (b.id === r.mateId && b.action === 'mate' && b.mateId === r.id)) &&
                mature(b, RULES) &&
                distance(r, b) < (passive ? RULES.preyMateDistance : RULES.mateDistance),
            );
        const threatened = world.wolves.some((w) => distance(w, r) < 4);
        if (mate && !threatened) reproduce(world, r, mate);
      }
    }
    if (r.energy <= 0) kill(world, r, 'starvation');
    else if (r.water <= 0) kill(world, r, 'dehydration');
    else if (r.age > (r.life?.deathAge ?? RULES.lifespan)) kill(world, r, 'oldAge');
  }
  const wolfOrder = [...world.wolves];
  const wolfOffset =
    world.experiments?.decisions && wolfOrder.length
      ? Math.floor(world.time * 20) % wolfOrder.length
      : 0;
  for (const w of [...wolfOrder.slice(wolfOffset), ...wolfOrder.slice(0, wolfOffset)]) {
    ageWolf(world, w, dt);
    careAndDisperse(world, w, dt);
    let caught = false;
    if (world.experiments?.resources)
      w.water = Math.max(0, (w.water ?? 80) - dt * (world.time < world.droughtUntil ? 0.5 : 0.2));
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (world.time >= w.nextHunt) {
      w.nextHunt = world.time + 0.65;
      let replanned = false;
      const group = world.groups.find((g) => g.id === w.lineage);
      if (group?.controller !== 'model') {
        const mate = availableWolfMates(world, w)[0];
        if (mate) {
          w.action = 'mate';
          w.mateId = mate.id;
          w.target = undefined;
        }
      }
      if (w.action === 'follow') {
        const leader = world.wolves.find(
          (other) => other.id === w.followId && visible(world, w, other, RULES.wolfSight),
        );
        if (leader) w.path = distance(w, leader) > 1.5 ? findRoute(world, w, leader) : [];
        else {
          w.action = 'rest';
          w.path = [];
          w.followId = undefined;
        }
        replanned = true;
      } else if (w.action === 'mate') {
        const mate = wolfMate(world, w, w.mateId);
        const route =
          mate && distance(w, mate) >= RULES.mateDistance ? findRoute(world, w, mate) : [];
        if (mate && (distance(w, mate) < RULES.mateDistance || route.length)) w.path = route;
        else {
          w.action = 'rest';
          w.mateId = undefined;
          w.path = [];
        }
        replanned = true;
      } else if (group?.controller === 'model') {
        if (w.action === 'hunt') {
          const prey = world.rabbits.find((r) => r.id === w.target);
          if (prey && w.cooldown <= 0 && wolfSeesPrey(world, w, prey)) {
            w.path = findRoute(world, w, prey);
          } else {
            w.action = 'rest';
            w.target = undefined;
            w.path = [];
          }
          replanned = true;
        }
      } else {
        const prey = world.rabbits
          .filter((r) => wolfSeesPrey(world, w, r))
          .sort((a, b) => distance(w, a) - distance(w, b) || a.id - b.id)[0];
        if (prey && w.cooldown <= 0) {
          w.target = prey.id;
          w.action = 'hunt';
          w.path = findRoute(world, w, prey);
          replanned = true;
        } else if (!w.path.length) {
          w.target = undefined;
          w.action = 'explore';
          const p = {
            x: 4 + Math.floor(random(world) * 56),
            y: 13 + Math.floor(random(world) * 44),
          };
          w.path = findRoute(world, w, p);
          replanned = true;
        }
      }
      if (replanned && w.path.length && distance(w, center(w)) > 0.05) w.path.unshift(center(w));
    }
    const moved = move(
      w,
      (dependent(world, w)
        ? 0
        : RULES.wolfSpeed *
          (world.experiments?.demographics && (w.age ?? 0) < RULES.wolfMaturity ? 0.65 : 1)) *
        (w.cooldown > 0 ? 0.35 : 1) *
        (tileAt(world, w)?.kind === 'forest' ? RULES.forestSpeed : 1),
      dt,
    );
    const reach = (r: Rabbit) => distance(w, r) < RULES.wolfCapture && !protectedRabbit(world, r);
    const chased = world.rabbits.find((r) => r.id === w.target);
    // Predator–prey: kills follow encounters (Lotka-Volterra's β·R·W) — the chased rabbit or any
    // exposed rabbit the wolf reaches, so more rabbits nearby means more meals.
    const prey =
      chased && reach(chased)
        ? chased
        : RULES.wolfEncounterKills && w.lineage
          ? world.rabbits.find(reach)
          : undefined;
    // Predator interference: crowded wolves get in each other's way, so each catches less.
    const rivals =
      prey && RULES.wolfInterference
        ? world.wolves.filter((o) => o !== w && distance(o, w) <= 4).length
        : 0;
    const eligibleAttack =
      !!prey &&
      w.cooldown <= 0 &&
      (!world.experiments?.demographics || (w.age ?? 0) >= RULES.wolfMaturity);
    const attempt = !world.experiments?.resources || (eligibleAttack && attemptedCatch(world, w));
    const interfered =
      attempt && rivals > 0 && random(world) >= 1 / (1 + RULES.wolfInterference * rivals);
    if (
      prey &&
      w.cooldown <= 0 &&
      !interfered &&
      attempt &&
      (!world.experiments?.demographics || (w.age ?? 0) >= RULES.wolfMaturity)
    ) {
      if (world.experiments?.resources) createCarcass(world, prey, w);
      kill(world, prey, 'predation');
      caught = true;
      if (w.lineage && world.stats[w.lineage]) world.stats[w.lineage].kills++;
      w.action = 'rest';
      w.cooldown = RULES.wolfEatCooldown;
      w.path = [];
      w.target = undefined;
    }
    if (world.experiments?.resources) {
      if (!w.path.length && w.action === 'drink') drink(world, w, dt * RULES.drinkRate);
      feedWolf(world, w, dt);
    }
    finishWolfLife(world, w, moved, caught && !world.experiments?.resources);
  }
  reproduceWolves(world);
  finishGestations(world);
  if (world.experiments?.demographics) boundaryMigration(world);
  else migrate(world);
  finishDrought(world);
  if (world.time - world.lastSample >= RULES.historySeconds) {
    world.lastSample = world.time;
    world.history.push({
      time: world.time,
      populations: Object.fromEntries(world.groups.map((g) => [g.id, groupPopulation(world, g)])),
      generation: Math.max(0, ...world.rabbits.map((r) => r.generation)),
    });
    world.history = world.history.slice(-RULES.historyLimit);
  }
}
export function meanGenes(world: World, lineage: Lineage): Genes | null {
  const rabbits = world.rabbits.filter((r) => r.lineage === lineage);
  return rabbits.length
    ? (Object.fromEntries(
        GENE_NAMES.map((k) => [
          k,
          rabbits.reduce((sum, r) => sum + r.genes[k], 0) / rabbits.length,
        ]),
      ) as Genes)
    : null;
}
// Predator–prey is an open population: a steady trickle of migrants joins beside an animal of
// their own kind (from the map edge only if none are left), whatever the current numbers.
function migrate(world: World) {
  const RULES = rulesFor(world);
  if (!RULES.migrationInterval) return;
  const migrants = (world.migrants ??= { wolves: 0, rabbits: 0, lastAt: 0 });
  if (world.time - migrants.lastAt < RULES.migrationInterval) return;
  migrants.lastAt = world.time;
  const edge = 4;
  const edgeTiles = world.tiles.filter(
    (t) =>
      t.kind === 'grass' &&
      walkable(world, t) &&
      (t.x < edge || t.y < edge || t.x >= GRID - edge || t.y >= GRID - edge),
  );
  const spotBeside = (animals: Point[]) => {
    for (let attempt = 0; attempt < 8 && animals.length; attempt++) {
      const host = animals[Math.floor(random(world) * animals.length)];
      const spot = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
        .map(([x, y]) => center({ x: host.x + x, y: host.y + y }))
        .find(
          (p) =>
            walkable(world, p) &&
            tileAt(world, p)?.kind !== 'shelter' &&
            ![...world.rabbits, ...world.wolves].some((a) => distance(a, p) < 0.5),
        );
      if (spot) return spot;
    }
    return edgeTiles.length ? edgeTiles[Math.floor(random(world) * edgeTiles.length)] : undefined;
  };
  const wolfGroup = world.groups.find((g) => g.species === 'wolf');
  for (let i = 0; wolfGroup && i < RULES.migrationWolves; i++) {
    const spot = spotBeside(world.wolves);
    if (!spot) break;
    const wolf = createWolf(world, wolfGroup.id, spot);
    wolf.reproductionCooldown = 0; // the founders' pup delay is for the opening only
    world.wolves.push(wolf);
    migrants.wolves++;
  }
  const rabbitGroup = world.groups.find((g) => g.species !== 'wolf')!;
  for (let i = 0; i < RULES.migrationRabbits; i++) {
    const spot = spotBeside(world.rabbits);
    if (!spot) break;
    const genes = Object.fromEntries(
      GENE_NAMES.map((k) => [k, 0.2 + random(world) * 0.6]),
    ) as Genes;
    const rabbit = createRabbit(world, rabbitGroup.id, spot, genes);
    rabbit.nextDecision = world.time;
    world.rabbits.push(rabbit);
    migrants.rabbits++;
  }
}
