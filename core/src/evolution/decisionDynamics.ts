import { rulesFor } from './constants.js';
import type { Point, Rabbit, Signal, Wolf, World } from './types.js';
import { distance, random, visible } from './world.js';

export function canReconsider(world: World, animal: Rabbit | Wolf) {
  if (!world.experiments?.decisions || world.time >= (animal.committedUntil ?? 0)) return true;
  if ('genes' in animal) {
    // Immediate needs can interrupt a commitment; a passing API response cannot freeze survival reactions.
    if (
      animal.energy < 20 ||
      animal.water < 20 ||
      world.wolves.some((w) => distance(w, animal) < 3 && visible(world, animal, w, 4))
    )
      return true;
    return (
      !animal.path.length && !['rest', 'forage', 'drink', 'hide', 'follow'].includes(animal.action)
    );
  }
  if ((animal.energy ?? 100) < 15 || (animal.water ?? 100) < 20) return true;
  return (
    !animal.path.length &&
    !['rest', 'hunt', 'scavenge', 'drink', 'follow'].includes(animal.action ?? 'rest') &&
    animal.carcassId === undefined
  );
}
export function heardSignals(world: World, animal: Point & { id: number }) {
  if (world.experiments?.communication === false) return [];
  return world.signals
    .filter(
      (s) =>
        s.delivered <= world.time &&
        s.expires > world.time &&
        s.sender !== animal.id &&
        (world.experiments?.decisions
          ? distance(animal, s) <= s.range
          : visible(world, animal, s, s.range)),
    )
    .map((s) => ({
      ...(world.experiments?.decisions ? { id: s.messageId } : {}),
      sender: s.sender,
      kind: s.kind,
      position: { x: s.x, y: s.y },
      age: world.time - s.delivered,
    }));
}
export function emitWolfSignal(world: World, wolf: Wolf, signal: Signal) {
  if (
    !world.experiments?.decisions ||
    world.experiments.communication === false ||
    signal === 'none' ||
    (wolf.energy ?? 0) <= 2
  )
    return;
  const rules = rulesFor(world);
  wolf.energy! -= rules.signalCost;
  world.signals.push({
    messageId: `${wolf.id}:${world.time.toFixed(6)}`,
    sender: wolf.id,
    lineage: wolf.lineage!,
    kind: signal,
    x: wolf.x,
    y: wolf.y,
    delivered: world.time + rules.signalDelay,
    expires: world.time + rules.signalLife,
    range: rules.wolfSight,
  });
  world.signals = world.signals.slice(-rules.maxSignalHistory);
  world.stats[wolf.lineage!].signals++;
}
export function permuteChoices<T>(world: World, animal: { id: number }, choices: T[]): T[] {
  if (!world.experiments?.decisions) return choices;
  // Isolated menu-order stream: shuffling must not consume ecological birth/attack randomness.
  const stream = {
    rng: (world.seed ^ Math.imul(animal.id, 0x9e3779b9) ^ Math.floor(world.time * 2)) >>> 0 || 1,
  };
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(random(stream) * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}
