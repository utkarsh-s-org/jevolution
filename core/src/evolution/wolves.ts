import { RULES } from './constants.js';
import type {
  Decision,
  Point,
  Rabbit,
  Wolf,
  WolfCandidate,
  WolfObservation,
  World,
} from './types.js';
import {
  addEvent,
  center,
  createWolf,
  distance,
  findRoute,
  tileAt,
  visible,
  walkable,
} from './world.js';

export function dynamicWolf(world: World, wolf: Wolf): boolean {
  return world.groups.find((g) => g.id === wolf.lineage)?.wolfLifeCycle === 'dynamic';
}
// Biology is identical for deterministic and model-controlled wolves.
export function ageWolf(world: World, wolf: Wolf, dt: number) {
  if (!dynamicWolf(world, wolf)) return;
  wolf.age = (wolf.age ?? RULES.wolfMaturity) + dt;
  wolf.energy = (wolf.energy ?? RULES.wolfFounderEnergy) - RULES.wolfMetabolism * dt;
  wolf.reproductionCooldown = Math.max(0, (wolf.reproductionCooldown ?? 0) - dt);
}
export function finishWolfLife(world: World, wolf: Wolf, moved: number, caught: boolean) {
  if (!dynamicWolf(world, wolf)) return;
  wolf.energy = (wolf.energy ?? RULES.wolfFounderEnergy) - moved * RULES.wolfMovementCost;
  if (caught) wolf.energy = Math.min(100, wolf.energy + RULES.wolfMealEnergy);
  if (wolf.energy <= 0 || wolf.age! > RULES.wolfLifespan) {
    const cause = wolf.energy <= 0 ? 'starvation' : 'oldAge';
    world.wolves = world.wolves.filter((w) => w.id !== wolf.id);
    wolf.pending = false;
    const stats = world.stats[wolf.lineage!];
    stats.deaths++;
    stats[cause]++;
    addEvent(
      world,
      'death',
      `Wolf #${wolf.id} · ${cause === 'oldAge' ? 'old age' : cause} · generation ${wolf.generation ?? 0}`,
      wolf.lineage,
    );
    return;
  }
}
export function wolfReadyToMate(world: World, wolf: Wolf): boolean {
  return (
    dynamicWolf(world, wolf) &&
    (wolf.age ?? 0) >= RULES.wolfMaturity &&
    (wolf.age ?? 0) <= RULES.wolfLifespan &&
    (wolf.energy ?? 0) >= RULES.wolfBreedEnergy &&
    (wolf.reproductionCooldown ?? 0) <= 0
  );
}
export function wolfMate(world: World, wolf: Wolf, id?: number): Wolf | undefined {
  if (!wolfReadyToMate(world, wolf)) return;
  return world.wolves.find(
    (other) =>
      other.id === id &&
      other.id !== wolf.id &&
      other.lineage === wolf.lineage &&
      wolfReadyToMate(world, other) &&
      tileAt(world, other)?.kind !== 'shelter' &&
      walkable(world, other) &&
      visible(world, wolf, other, RULES.wolfSight),
  );
}
export function availableWolfMates(world: World, wolf: Wolf): Wolf[] {
  if (world.wolves.length >= RULES.wolfPopulationCap || !wolfReadyToMate(world, wolf)) return [];
  return world.wolves
    .filter(
      (other) =>
        wolfMate(world, wolf, other.id) &&
        (distance(wolf, other) < RULES.mateDistance || findRoute(world, wolf, other).length),
    )
    .sort(
      (a, b) =>
        Number(b.mateId === wolf.id) - Number(a.mateId === wolf.id) ||
        distance(wolf, a) - distance(wolf, b) ||
        a.id - b.id,
    );
}
// Run after every adult has moved and paid metabolism: dead/ineligible partners
// cannot reproduce, and newborns never receive an extra update in their birth step.
export function reproduceWolves(world: World) {
  for (const wolf of [...world.wolves]) {
    if (world.wolves.length >= RULES.wolfPopulationCap) return;
    if (wolf.action !== 'mate') continue;
    const mate = wolfMate(world, wolf, wolf.mateId);
    if (
      !mate ||
      mate.action !== 'mate' ||
      mate.mateId !== wolf.id ||
      distance(wolf, mate) >= RULES.mateDistance
    )
      continue;
    const position = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([x, y]) => center({ x: wolf.x + x, y: wolf.y + y }))
      .find(
        (p) =>
          walkable(world, p) &&
          tileAt(world, p)?.kind !== 'shelter' &&
          ![...world.rabbits, ...world.wolves].some((animal) => distance(animal, p) < 0.5),
      );
    if (!position) continue;
    const child = createWolf(world, wolf.lineage!, position, [wolf, mate]);
    world.wolves.push(child);
    for (const parent of [wolf, mate]) {
      parent.energy! -= RULES.wolfBreedCost;
      parent.reproductionCooldown = RULES.wolfBreedCooldown;
      parent.action = 'rest';
      parent.path = [];
      parent.target = undefined;
      parent.mateId = undefined;
      parent.nextDecision = world.time;
    }
    world.stats[wolf.lineage!].births++;
    addEvent(
      world,
      'birth',
      `Wolf #${child.id} born · generation ${child.generation} · parents #${wolf.id} + #${mate.id}`,
      wolf.lineage,
    );
  }
}

export function wolfSeesPrey(world: World, wolf: Wolf, rabbit: Rabbit): boolean {
  const tile = tileAt(world, rabbit);
  return (
    !!tile &&
    tile.kind !== 'shelter' &&
    visible(
      world,
      wolf,
      rabbit,
      rabbit.action === 'hide' && tile.kind === 'forest'
        ? RULES.shelteredWolfRange
        : RULES.wolfSight,
    )
  );
}
export function observeWolf(world: World, wolf: Wolf): WolfObservation {
  const prey = world.rabbits
    .filter((r) => wolfSeesPrey(world, wolf, r))
    .sort((a, b) => distance(wolf, a) - distance(wolf, b) || a.id - b.id);
  const choices: WolfCandidate[] = [
    {
      id: 'rest',
      action: 'rest',
      description: 'Stop and wait. Eating cooldown continues to expire.',
    },
  ];
  for (const mate of availableWolfMates(world, wolf).slice(0, 3))
    choices.push({
      id: `mate_${mate.id}`,
      action: 'mate',
      mateId: mate.id,
      target: center(mate),
      description: `Reproduce with wolf ${mate.id}. Both must choose each other and meet within ${RULES.mateDistance} tiles. Each parent pays ${RULES.wolfBreedCost} energy and waits ${RULES.wolfBreedCooldown}s before another birth.${mate.mateId === wolf.id ? ' This wolf has chosen you.' : ''}`,
    });
  if (wolf.cooldown <= 0) {
    for (const r of prey.slice(0, 6)) {
      if (distance(wolf, r) > 0.8 && !findRoute(world, wolf, r).length) continue;
      choices.push({
        id: `hunt_${r.id}`,
        action: 'hunt',
        preyId: r.id,
        description: `Hunt visible rabbit ${r.id}, ${distance(wolf, r).toFixed(1)} tiles away. Track only while visible; catching it starts an 18-second eating cooldown.`,
      });
    }
  }
  for (const [dx, dy, name] of [
    [1, 0, 'east'],
    [-1, 0, 'west'],
    [0, 1, 'south'],
    [0, -1, 'north'],
  ] as const) {
    for (let steps = 5; steps >= 1; steps--) {
      const target = center({ x: wolf.x + dx * steps, y: wolf.y + dy * steps });
      if (
        !walkable(world, target) ||
        !visible(world, wolf, target, RULES.wolfSight) ||
        !findRoute(world, wolf, target).length
      )
        continue;
      choices.push({
        id: `explore_${name}`,
        action: 'explore',
        target,
        description: `Patrol ${name} to (${target.x},${target.y}), ${distance(wolf, target).toFixed(1)} tiles away. Find prey beyond your current position.`,
      });
      break;
    }
  }
  return {
    wolf: {
      id: wolf.id,
      lifeCycle: dynamicWolf(world, wolf) ? 'dynamic' : 'fixed',
      energy: dynamicWolf(world, wolf) ? (wolf.energy ?? RULES.wolfFounderEnergy) : null,
      age: dynamicWolf(world, wolf) ? (wolf.age ?? RULES.wolfMaturity) : null,
      generation: wolf.generation ?? 0,
      mateId: wolf.mateId,
      reproductionCooldown: dynamicWolf(world, wolf) ? (wolf.reproductionCooldown ?? 0) : null,
      position: { x: wolf.x, y: wolf.y },
      action: wolf.action || 'rest',
      cooldown: wolf.cooldown,
      hungry: wolf.cooldown <= 0,
    },
    environment: { time: world.time, tile: tileAt(world, wolf)!.kind },
    prey: prey.map((r) => ({ id: r.id, position: { x: r.x, y: r.y }, moving: r.path.length > 0 })),
    neighbors: world.wolves
      .filter((w) => w.id !== wolf.id && visible(world, wolf, w, RULES.wolfSight))
      .map((w) => ({
        id: w.id,
        position: { x: w.x, y: w.y },
        action: w.action || 'rest',
        ally: w.lineage === wolf.lineage,
        mateId: w.mateId,
        readyToMate: wolfReadyToMate(world, w),
      })),
    choices,
  };
}
export function applyWolfDecision(
  world: World,
  wolf: Wolf,
  decision: Decision,
  choices: WolfCandidate[],
): boolean {
  const choice = choices.find((c) => c.id === decision.choice);
  if (!choice || decision.signal !== 'none') return false;
  let target: Point | undefined = choice.target;
  if (choice.action === 'hunt') {
    const prey = world.rabbits.find((r) => r.id === choice.preyId);
    if (wolf.cooldown > 0 || !prey || !wolfSeesPrey(world, wolf, prey)) return false;
    target = prey;
  }
  if (choice.action === 'mate') {
    const mate = wolfMate(world, wolf, choice.mateId);
    if (!mate || world.wolves.length >= RULES.wolfPopulationCap) return false;
    target = mate;
  }
  if (target && (!walkable(world, target) || !visible(world, wolf, target, RULES.wolfSight)))
    return false;
  const route = target ? findRoute(world, wolf, target) : [];
  if (target && distance(wolf, target) > 0.8 && !route.length) return false;
  wolf.action = choice.action;
  wolf.target = choice.preyId;
  wolf.mateId = choice.mateId;
  wolf.path = route;
  wolf.nextHunt = world.time;
  if (route.length && distance(wolf, center(wolf)) > 0.05) route.unshift(center(wolf));
  return true;
}
