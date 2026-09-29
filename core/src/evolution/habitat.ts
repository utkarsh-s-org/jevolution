import type { Point, Rabbit, Tile, Wolf, World } from './types.js';
import { cell, distance, tileAt } from './world.js';

export function waterSource(world: World, p: Point): Tile | undefined {
  const c = cell(p);
  return [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]
    .map(([dx, dy]) => tileAt(world, { x: c.x + dx, y: c.y + dy }))
    .find((t) => t?.kind === 'water' && (!world.experiments?.resources || (t.water ?? 100) > 0.01));
}
export function drink(world: World, animal: Point & { water?: number }, amount: number) {
  const source = waterSource(world, animal);
  if (!source) return;
  const actual = Math.max(0, Math.min(amount, 100 - (animal.water ?? 100), source.water ?? 100));
  animal.water = (animal.water ?? 100) + actual;
  if (world.experiments?.resources) {
    source.water = (source.water ?? 100) - actual;
    const m = (world.mechanisms ??= {});
    m.waterConsumed = (m.waterConsumed ?? 0) + actual;
  }
}
export function shelterEntry(world: World, rabbit: Rabbit) {
  const tile = tileAt(world, rabbit);
  const key = tile?.kind === 'shelter' ? `${tile.x},${tile.y}` : undefined;
  if (rabbit.shelterKey !== key) {
    rabbit.shelterKey = key;
    rabbit.shelterArrival = key ? world.time : undefined;
  }
}
export function protectedRabbit(world: World, rabbit: Rabbit) {
  const tile = tileAt(world, rabbit);
  if (tile?.kind !== 'shelter') return false;
  if (!world.experiments?.resources) return true;
  return world.rabbits
    .filter((r) => {
      const t = tileAt(world, r);
      return t?.x === tile.x && t.y === tile.y;
    })
    .sort(
      (a, b) => (a.shelterArrival ?? world.time) - (b.shelterArrival ?? world.time) || a.id - b.id,
    )
    .slice(0, 2)
    .includes(rabbit);
}
export function advanceHabitat(world: World, dt: number) {
  if (!world.experiments?.resources) return;
  const drought = world.time < world.droughtUntil;
  for (const tile of world.tiles)
    if (tile.kind === 'water')
      tile.water = Math.max(0, Math.min(100, (tile.water ?? 100) + dt * (drought ? -2 : 0.4)));
  for (const c of world.carcasses ?? []) {
    const decay = Math.min(c.energy, dt * 0.2);
    c.energy -= decay;
    const m = (world.mechanisms ??= {});
    m.carcassDecay = (m.carcassDecay ?? 0) + decay;
  }
  world.carcasses = (world.carcasses ?? []).filter((c) => c.energy > 0.001);
}
export function createCarcass(world: World, prey: Rabbit, wolf: Wolf) {
  const energy = Math.max(0, prey.energy) * 0.65;
  const list = (world.carcasses ??= []);
  list.push({ id: prey.id, x: prey.x, y: prey.y, energy, createdAt: world.time });
  wolf.carcassId = prey.id;
  const m = (world.mechanisms ??= {});
  m.carcassEnergyCreated = (m.carcassEnergyCreated ?? 0) + energy;
}
export function feedWolf(world: World, wolf: Wolf, dt: number) {
  if (!world.experiments?.resources) return;
  const carcass = (world.carcasses ?? []).find(
    (c) => c.id === wolf.carcassId && distance(c, wolf) <= 1.2,
  );
  if (!carcass) {
    wolf.carcassId = undefined;
    return;
  }
  const bite = Math.max(0, Math.min(carcass.energy, dt * 8, 100 - (wolf.energy ?? 0)));
  wolf.energy = (wolf.energy ?? 0) + bite;
  carcass.energy -= bite;
  const m = (world.mechanisms ??= {});
  m.carcassEnergyEaten = (m.carcassEnergyEaten ?? 0) + bite;
  if (carcass.energy <= 0.001 || (wolf.energy ?? 0) >= 100) wolf.carcassId = undefined;
}
export function attemptedCatch(world: World, wolf: Wolf): boolean {
  if (!world.experiments?.resources) return true;
  if (world.time < (wolf.nextAttack ?? 0)) return false;
  wolf.nextAttack = world.time + 0.8;
  wolf.energy = (wolf.energy ?? 0) - 0.6;
  const m = (world.mechanisms ??= {});
  m.attackAttempts = (m.attackAttempts ?? 0) + 1;
  // Called only once per recovery interval; probability is no longer retried every render/tick.
  return (wolf.energy ?? 0) > 0;
}
export function wolfNeedsDrink(world: World, wolf: Wolf) {
  return !!world.experiments?.resources && (wolf.water ?? 100) < 85;
}
