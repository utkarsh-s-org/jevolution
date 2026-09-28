import { GENE_NAMES, GRID, rulesFor } from './constants.js';
import { type Experiments, LIFE } from './experiments.js';
import type { Genes, Rabbit, Wolf, World } from './types.js';
import {
  addEvent,
  center,
  createRabbit,
  createWolf,
  disperse,
  distance,
  random,
  walkable,
} from './world.js';

type Animal = Rabbit | Wolf;
const species = (animal: Animal) => ('genes' in animal ? 'rabbit' : 'wolf');
// Separate deterministic stream: adding demographic attributes must not move the original founders/map.
function fraction(world: World, id: number, salt: number) {
  const stream = { rng: (Math.imul(id + salt, 0x9e3779b9) ^ world.seed) >>> 0 || 1 };
  return random(stream);
}
export function initializeLife(world: World, animal: Animal, founder: boolean) {
  const rule = LIFE[species(animal)];
  animal.life = {
    sex: fraction(world, animal.id, 17) < 0.5 ? 'female' : 'male',
    deathAge: rule.lifespan * (0.8 + fraction(world, animal.id, 93) * 0.4),
    dispersed: founder,
  };
  if (founder) animal.age = rule.maturity + fraction(world, animal.id, 41) * rule.lifespan * 0.25;
}
export function configureExperiments(world: World, settings: Experiments) {
  if (world.time !== 0) throw new Error('Mechanisms can only be configured before a run starts.');
  world.experiments = { ...settings };
  if (settings.demographics)
    for (const a of [...world.rabbits, ...world.wolves]) initializeLife(world, a, true);
}
export function dependent(world: World, animal: Animal) {
  return !!world.experiments?.demographics && (animal.age ?? 0) < LIFE[species(animal)].dependent;
}
export function compatible(world: World, a: Animal, b: Animal) {
  return (
    !world.experiments?.demographics ||
    (a !== b &&
      !!a.life &&
      !!b.life &&
      a.life.sex !== b.life.sex &&
      !a.life.pregnancy &&
      !b.life.pregnancy)
  );
}
export function conceive(world: World, a: Animal, b: Animal): boolean {
  if (!compatible(world, a, b)) return false;
  const mother = a.life?.sex === 'female' ? a : b;
  const father = mother === a ? b : a;
  const rule = LIFE[species(mother)];
  // Reserve the newborns' initial energy now, split between the two parents; no free energy at birth.
  const cost = (rule.childEnergy * rule.litter) / 2;
  if ((a.energy ?? 0) <= cost + 10 || (b.energy ?? 0) <= cost + 10) return false;
  a.energy! -= cost;
  b.energy! -= cost;
  mother.life!.pregnancy = {
    due: world.time + rule.gestation,
    father: father.id,
    generation: Math.max(a.generation ?? 0, b.generation ?? 0) + 1,
    ...('genes' in father ? { fatherGenes: { ...father.genes } } : {}),
  };
  for (const parent of [a, b]) {
    if ('genes' in parent) parent.cooldown = rule.gestation + rulesFor(world).breedCooldown;
    else parent.reproductionCooldown = rule.gestation + rulesFor(world).wolfBreedCooldown;
  }
  const m = (world.mechanisms ??= {});
  m.conceptions = (m.conceptions ?? 0) + 1;
  addEvent(
    world,
    'system',
    `${species(mother)} #${mother.id} conceived with #${father.id}; due at ${mother.life!.pregnancy.due.toFixed(1)}s.`,
    mother.lineage,
  );
  return true;
}
export function careAndDisperse(world: World, animal: Animal, dt: number) {
  if (!world.experiments?.demographics) return;
  if (!animal.life) initializeLife(world, animal, (animal.generation ?? 0) === 0);
  const life = LIFE[species(animal)];
  if (dependent(world, animal)) {
    animal.path = [];
    animal.action = 'rest';
    const population: Animal[] = 'genes' in animal ? world.rabbits : world.wolves;
    const parent = population.find(
      (p) => animal.parents?.includes(p.id) && distance(p, animal) <= 2 && (p.energy ?? 0) > 30,
    );
    if (parent) {
      const transfer = Math.max(
        0,
        Math.min(dt * 2, (parent.energy ?? 0) - 30, 40 - (animal.energy ?? 0)),
      );
      parent.energy! -= transfer;
      animal.energy! += transfer;
      const m = (world.mechanisms ??= {});
      m.careEnergy = (m.careEnergy ?? 0) + transfer;
    }
  }
  if (!animal.life!.dispersed && (animal.age ?? 0) >= life.maturity) {
    animal.life!.dispersed = true;
    disperse(world, animal);
  }
}
export function finishGestations(world: World) {
  if (!world.experiments?.demographics) return;
  const rules = rulesFor(world);
  for (const mother of [...world.rabbits, ...world.wolves]) {
    const pregnancy = mother.life?.pregnancy;
    if (!pregnancy || pregnancy.due > world.time) continue;
    delete mother.life!.pregnancy;
    const rabbit = 'genes' in mother;
    const rule = LIFE[rabbit ? 'rabbit' : 'wolf'];
    const population = rabbit ? world.rabbits : world.wolves;
    const cap = rabbit ? rules.maxPopulation : rules.wolfPopulationCap;
    for (let i = 0; i < rule.litter; i++) {
      if (population.length >= cap) {
        const m = (world.mechanisms ??= {});
        m.capacityBlocked = (m.capacityBlocked ?? 0) + rule.litter - i;
        break;
      }
      // Dependent littermates share the mother's nest, rather than immediately dispersing.
      let child: Animal;
      if (rabbit) {
        const genes = Object.fromEntries(
          GENE_NAMES.map((k) => [
            k,
            Math.max(
              0.05,
              Math.min(
                0.95,
                (mother.genes[k] + pregnancy.fatherGenes![k]) / 2 +
                  (random(world) - 0.5) * 2 * rules.mutation,
              ),
            ),
          ]),
        ) as Genes;
        child = createRabbit(world, mother.lineage, mother, genes, pregnancy.generation, [
          mother.id,
          pregnancy.father,
        ]);
        world.rabbits.push(child);
      } else {
        child = createWolf(world, mother.lineage!, mother, [mother]);
        child.parents = [mother.id, pregnancy.father];
        child.generation = pregnancy.generation;
        world.wolves.push(child);
      }
      child.energy = rule.childEnergy;
      initializeLife(world, child, false);
      child.nextDecision = world.time + rule.dependent;
      world.stats[mother.lineage!].births++;
      addEvent(
        world,
        'birth',
        `${rabbit ? 'Rabbit' : 'Wolf'} #${child.id} born after gestation; parents #${mother.id} + #${pregnancy.father}.`,
        mother.lineage,
      );
    }
  }
}
export function boundaryMigration(world: World) {
  if (!world.experiments?.demographics) return;
  if (world.experiments.immigration === 'closed') return;
  const migrants = (world.migrants ??= { wolves: 0, rabbits: 0, lastAt: 0 });
  if (world.time - migrants.lastAt < 20) return;
  migrants.lastAt = world.time;
  const rules = rulesFor(world);
  const sites = world.tiles.filter(
    (t) =>
      (t.x === 0 || t.y === 0 || t.x === GRID - 1 || t.y === GRID - 1) &&
      walkable(world, t) &&
      t.kind !== 'shelter',
  );
  for (const kind of ['rabbit', 'wolf'] as const) {
    const key = kind === 'rabbit' ? 'rabbits' : 'wolves';
    const count = kind === 'rabbit' ? 2 : 1;
    const sourceLimit = kind === 'rabbit' ? 20 : 10;
    const cap = kind === 'rabbit' ? rules.maxPopulation : rules.wolfPopulationCap;
    const group = world.groups.find((g) => (g.species ?? 'rabbit') === kind);
    if (!group) continue;
    for (let n = 0; n < count && migrants[key] < sourceLimit && world[key].length < cap; n++) {
      const available = sites.filter(
        (t) => ![...world.rabbits, ...world.wolves].some((a) => distance(a, center(t)) < 0.5),
      );
      if (!available.length) break;
      const p = available[Math.floor(random(world) * available.length)];
      let animal: Animal;
      if (kind === 'rabbit') {
        const genes = Object.fromEntries(
          GENE_NAMES.map((k) => [k, 0.2 + random(world) * 0.6]),
        ) as Genes;
        animal = createRabbit(world, group.id, p, genes);
        world.rabbits.push(animal);
      } else {
        animal = createWolf(world, group.id, p);
        world.wolves.push(animal);
      }
      initializeLife(world, animal, true);
      animal.nextDecision = world.time;
      migrants[key]++;
      addEvent(world, 'system', `${kind} #${animal.id} entered at map boundary.`, group.id);
    }
  }
}
