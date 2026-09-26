import { RULES } from './constants.js';
import type { Candidate, Point, Rabbit, ReliefEvent, Tile, World } from './types.js';
import { center, distance, findRoute, visible } from './world.js';

// Choices and mechanics are shared by every provider. No roles are assigned by the engine.
export function reliefChoices(
  world: World,
  r: Rabbit,
  neighbors: Rabbit[],
  tiles: Tile[],
  radius: number,
): Candidate[] {
  const choices: Candidate[] = [];
  const add = (
    action: Candidate['action'],
    target: Point,
    description: string,
    extra: Partial<Candidate> = {},
  ) => {
    const dest = center(target);
    if (distance(r, dest) > 0.8 && !findRoute(world, r, dest).length) return;
    const id = `${action}_${extra.recipientId ?? extra.cacheId ?? `${dest.x}_${dest.y}`}`;
    if (choices.some((c) => c.id === id)) return;
    choices.push({
      id,
      action,
      target: dest,
      description,
      ...extra,
    });
  };
  if (r.cargo < RULES.cargoCapacity - 0.1) {
    for (const tile of [...tiles]
      .filter((t) => t.food > 0.5)
      .sort((a, b) => b.food / (1 + distance(r, b)) - a.food / (1 + distance(r, a)))
      .slice(0, 2))
      add(
        'collect',
        tile,
        `Collect food to carry at (${tile.x},${tile.y}); ${tile.food.toFixed(1)} available. Carry up to ${RULES.cargoCapacity}; collection does not feed you. You can later eat, deliver, or store it.`,
      );
  }
  if (r.cargo > 0.1) {
    if (r.energy < 95)
      choices.push({
        id: 'eatCargo',
        action: 'eatCargo',
        description: `Eat your carried food (${r.cargo.toFixed(1)} units). Each unit restores ${RULES.foodEnergy} energy and is no longer available to share.`,
      });
    for (const n of [...neighbors]
      .filter((n) => n.energy < RULES.hungryEnergy)
      .sort((a, b) => a.energy - b.energy || distance(r, a) - distance(r, b))
      .slice(0, 3))
      add(
        'share',
        n,
        `Deliver carried food to hungry rabbit #${n.id} (${n.lineage === r.lineage ? 'same' : 'other'} lineage, energy ${n.energy.toFixed(0)}). Track only while visible and feed within ${RULES.shareRange} tiles. You give up the food.`,
        { recipientId: n.id },
      );
  }
  for (const cache of world.caches
    .filter((c) => visible(world, r, c, radius))
    .sort((a, b) => distance(r, a) - distance(r, b))
    .slice(0, 2)) {
    if (r.cargo > 0.1 && cache.food < RULES.cacheCapacity - 0.1)
      add(
        'deposit',
        cache,
        `Store your carried food in communal cache #${cache.id + 1} (${cache.food.toFixed(1)}/${RULES.cacheCapacity}). Any lineage can use it later.`,
        { cacheId: cache.id },
      );
    if (cache.food > 0.1 && r.cargo < RULES.cargoCapacity - 0.1)
      add(
        'withdraw',
        cache,
        `Take food from communal cache #${cache.id + 1} (${cache.food.toFixed(1)} available) into your inventory. Then choose to eat or deliver it.`,
        { cacheId: cache.id },
      );
  }
  if (r.cargo > 0.1) {
    // A heard request reveals its location, not the sender's unseen current state.
    for (const s of world.signals
      .filter(
        (s) =>
          s.kind === 'help' &&
          s.sender !== r.id &&
          s.delivered <= world.time &&
          s.expires > world.time &&
          visible(world, r, s, s.range) &&
          !neighbors.some((n) => n.id === s.sender),
      )
      .slice(-2))
      add(
        'explore',
        s,
        `Investigate food request from rabbit #${s.sender} at (${s.x.toFixed(1)},${s.y.toFixed(1)}). This is its signal location; find it before choosing a delivery.`,
      );
  }
  return choices;
}

export function recordRelief(
  world: World,
  r: Rabbit,
  event: Omit<ReliefEvent, 'id' | 'time' | 'actor' | 'lineage'>,
) {
  world.reliefEvents.push({
    id: world.nextReliefId++,
    time: world.time,
    actor: r.id,
    lineage: r.lineage,
    ...event,
  });
  world.reliefEvents = world.reliefEvents.slice(-RULES.reliefEventLimit);
}

export function validReliefChoice(
  world: World,
  r: Rabbit,
  choice: Candidate,
  radius: number,
): boolean {
  if (choice.action === 'share') {
    const recipient = world.rabbits.find((n) => n.id === choice.recipientId && n.id !== r.id);
    if (
      !recipient ||
      recipient.energy >= RULES.hungryEnergy ||
      r.cargo <= 0.1 ||
      !visible(world, r, recipient, radius)
    )
      return false;
  }
  if (choice.action === 'eatCargo' && (r.cargo <= 0.1 || r.energy >= 100)) return false;
  if (choice.action === 'collect' && r.cargo >= RULES.cargoCapacity - 0.1) return false;
  if (choice.action === 'deposit' || choice.action === 'withdraw') {
    const cache = world.caches.find((c) => c.id === choice.cacheId);
    if (!cache) return false;
    if (choice.action === 'deposit' && (r.cargo <= 0.1 || cache.food >= RULES.cacheCapacity - 0.1))
      return false;
    if (choice.action === 'withdraw' && (cache.food <= 0.1 || r.cargo >= RULES.cargoCapacity - 0.1))
      return false;
  }
  return true;
}

export function stepRelief(world: World, r: Rabbit, tile: Tile, dt: number) {
  const position = { x: r.x, y: r.y };
  const rate = dt * RULES.eatRate * (1 - r.genes.thrift * 0.3);
  if (r.action === 'collect') {
    const amount = Math.min(tile.food, rate, RULES.cargoCapacity - r.cargo);
    if (amount > 0) {
      tile.food -= amount;
      r.cargo += amount;
      // Merge adjacent collection ticks into one physical pickup, not one event per tick.
      const last = [...world.reliefEvents].reverse().find((e) => e.actor === r.id);
      if (
        last?.kind === 'collect' &&
        last.actor === r.id &&
        distance(last.to, position) < 0.1 &&
        world.time - last.time < 0.2
      ) {
        last.amount += amount;
        last.time = world.time;
      } else recordRelief(world, r, { kind: 'collect', amount, from: position, to: position });
    }
  }
  if (r.action === 'eatCargo') {
    const amount = Math.min(r.cargo, Math.max(0, 100 - r.energy) / RULES.foodEnergy);
    if (amount > 0) {
      const energyBefore = r.energy;
      r.cargo -= amount;
      r.energy += amount * RULES.foodEnergy;
      world.stats[r.lineage].food += amount;
      recordRelief(world, r, {
        kind: 'eatCargo',
        amount,
        from: position,
        to: position,
        energyBefore,
        energyAfter: r.energy,
      });
    }
    r.action = 'rest';
  }
  if (r.action === 'share') {
    const n = world.rabbits.find((n) => n.id === r.recipientId);
    if (n && n.energy < RULES.hungryEnergy && distance(r, n) <= RULES.shareRange) {
      const amount = Math.min(r.cargo, (100 - n.energy) / RULES.foodEnergy);
      if (amount > 0.1) {
        const energyBefore = n.energy;
        const responseSeconds =
          n.helpRequestedAt === undefined ? undefined : world.time - n.helpRequestedAt;
        r.cargo -= amount;
        n.energy += amount * RULES.foodEnergy;
        n.helpRequestedAt = undefined;
        world.stats[n.lineage].food += amount;
        const stats = world.stats[r.lineage].relief;
        stats.deliveries++;
        stats.foodShared += amount;
        if (energyBefore < RULES.urgentEnergy && n.energy >= RULES.urgentEnergy) stats.urgentFed++;
        if (responseSeconds !== undefined) stats.responses.push(responseSeconds);
        recordRelief(world, r, {
          kind: 'share',
          recipient: n.id,
          amount,
          from: position,
          to: { x: n.x, y: n.y },
          energyBefore,
          energyAfter: n.energy,
          responseSeconds,
        });
      }
      r.action = 'rest';
      r.path = [];
      r.recipientId = undefined;
    }
  }
  if (r.action === 'deposit' || r.action === 'withdraw') {
    const cache = world.caches.find((c) => distance(r, c) < 0.8);
    if (!cache) return;
    const depositing = r.action === 'deposit';
    const amount = depositing
      ? Math.min(r.cargo, RULES.cacheCapacity - cache.food)
      : Math.min(cache.food, RULES.cargoCapacity - r.cargo);
    if (amount > 0.1) {
      cache.food += depositing ? amount : -amount;
      r.cargo += depositing ? -amount : amount;
      world.stats[r.lineage].relief[depositing ? 'deposited' : 'withdrawn'] += amount;
      recordRelief(world, r, {
        kind: r.action,
        cacheId: cache.id,
        amount,
        from: position,
        to: { x: cache.x, y: cache.y },
      });
    }
    r.action = 'rest';
  }
  if (r.energy >= RULES.hungryEnergy) r.helpRequestedAt = undefined;
}

export function finishDrought(world: World) {
  const report = world.droughtReport;
  if (report && !report.survivors && world.time >= report.endsAt) {
    report.deliveries = Object.fromEntries(
      world.groups.map((g) => [
        g.id,
        world.stats[g.id].relief.deliveries - report.baseline[g.id].deliveries,
      ]),
    );
    const alive = new Set(world.rabbits.map((r) => r.id));
    report.survivors = Object.fromEntries(
      Object.entries(report.cohort).map(([id, cohort]) => [
        id,
        cohort.filter((id) => alive.has(id)).length,
      ]),
    );
  }
}
