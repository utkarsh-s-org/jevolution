import type { Genes, ModelGroup, Provider, RunConfig, Scenario, Species, World } from './types.js';

export const GRID = 64;
export const DEFAULT_SEED = 8675309;
export const INITIAL_PER_LINEAGE = 40;
export const MAX_POPULATION = 180;
export const GENE_NAMES = ['speed', 'vigilance', 'thrift', 'fertility', 'sociability'] as const;
export const DEFAULT_CONFIG: RunConfig = {
  scenario: 'arena',
  timeScale: 1,
  deadlineMs: 2500,
  decisionIntervalMs: 100,
  maxInFlight: 4,
  timing: 'realtime',
  equalizedMs: 3000,
  maxRequests: 20000,
  maxSeconds: 600,
};
export const RULES = {
  tickMs: 50,
  snapshotMs: 200,
  historySeconds: 2,
  historyLimit: 1200,
  eventLimit: 60,
  foodCapacity: 6,
  cargoCapacity: 4,
  cacheCapacity: 32,
  shareRange: 1.5,
  hungryEnergy: 55,
  urgentEnergy: 25,
  helpCooldown: 6,
  reliefEventLimit: 160,
  droughtWither: 0.025,
  foodRegrowth: 0.03,
  droughtRegrowth: 0.0064,
  baseMetabolism: 0.3,
  restMetabolism: 1,
  visionMetabolism: 0.06,
  speedMetabolism: 0.05,
  baseSpeed: 1.05,
  speedGain: 0.65,
  movementCost: 0.1,
  thirst: 0.15,
  droughtThirst: 0.22,
  drinkRate: 16,
  eatRate: 1.4,
  forageBout: 2,
  foodEnergy: 4,
  maturity: 25,
  founderEnergy: 75,
  founderWater: 90,
  childEnergy: 65,
  childWater: 80,
  breedEnergy: 62,
  breedWater: 35,
  breedCost: 25,
  breedCooldown: 25,
  lifespan: 340,
  mutation: 0.065,
  mateDistance: 1.7,
  wolfCount: 10,
  wolfPopulationCap: 32,
  wolfFounderEnergy: 60,
  wolfChildEnergy: 35,
  wolfMetabolism: 0.6,
  wolfMovementCost: 0.1,
  wolfMealEnergy: 45,
  wolfMaturity: 30,
  wolfLifespan: 240,
  wolfBreedEnergy: 95,
  wolfBreedCost: 50,
  wolfBreedCooldown: 45,
  wolfSpeed: 1.55,
  wolfSight: 10,
  wolfEatCooldown: 18,
  wolfCapture: 0.6,
  signalDelay: 0.2,
  signalLife: 6,
  signalCost: 0.6,
  forestSpeed: 0.77,
  shelteredWolfRange: 2,
  maxSignalHistory: 200,
  memoryLimit: { food: 4, water: 2, danger: 4 },
  memoryLife: { food: 120, water: 180, danger: 20 },
  followReplan: 0.65,
  // Predator–prey preset only (PREDATOR_PREY_RULES); the arena leaves these at their defaults.
  shelterCount: 6,
  wolfSpacing: 10,
  wolfClearance: 6,
  maxPopulation: MAX_POPULATION,
  /** Rabbit births slow as the count nears this (logistic); 0 disables. */
  rabbitCapacity: 0,
  /** Food carrying, sharing, caches, and the "Need food" signal (drought relief). */
  reliefEnabled: 1,
  /** Predator–prey: how close two ready wolves must be to have a pup. */
  wolfPairDistance: 3,
  /** Predator–prey: a well-fed wolf has a pup beside it on its own (one parent). */
  wolfSoloPups: 0,
  /** Predator–prey: a mature, fed rabbit has a litter on its own (female-only population model). */
  rabbitSoloBirths: 0,
  /** Predator–prey: list movement directions in a random order, so a model's habit of
   *  picking the first option doesn't send every animal the same way (east). */
  shuffleDirections: 0,
  /** Seconds before a founding (or arriving) wolf can have its first pup. */
  wolfFounderPupDelay: 0,
  /** Newborns walk this many tiles (min–max) away from home before deciding; 0 disables. */
  dispersalMin: 0,
  dispersalMax: 0,
  /** Rabbit births slow as neighbours within localCrowdRadius near localCapacity; 0 disables. */
  localCapacity: 0,
  localCrowdRadius: 6,
  /** Predator interference: a catch succeeds with 1 / (1 + k × other wolves within 4 tiles). */
  wolfInterference: 0,
  /** Predator–prey: wolves can follow scent toward rabbits beyond sight. */
  wolfScent: 0,
  wolfScentRange: 18,
  passiveBreeding: 0,
  preyMateDistance: 1.7,
  wolfEncounterKills: 0,
  /** Open population: every migrationInterval s, migrants join beside one of their own kind. */
  migrationInterval: 0,
  migrationWolves: 1,
  migrationRabbits: 2,
} as const;
/** RULES with literal types widened, so a scenario can override any value. */
export type Rules = {
  readonly [K in keyof typeof RULES]: (typeof RULES)[K] extends number ? number : (typeof RULES)[K];
};
export const POPULATION_BUDGET: Record<Species, number> = { rabbit: 80, wolf: RULES.wolfCount };
export const TRAIT_INFO: Record<keyof Genes, { label: string; benefit: string; cost: string }> = {
  speed: {
    label: 'Speed',
    benefit: 'Faster movement and escape',
    cost: 'Higher resting and movement energy use',
  },
  vigilance: {
    label: 'Vigilance',
    benefit: 'Wider local vision',
    cost: 'Higher resting energy use',
  },
  thrift: {
    label: 'Thrift',
    benefit: 'Lower resting metabolism',
    cost: 'Slower movement and food intake',
  },
  fertility: {
    label: 'Fertility',
    benefit: 'Shorter reproduction cooldown',
    cost: 'Higher energy cost per offspring',
  },
  sociability: {
    label: 'Sociability',
    benefit: 'Longer local signal range',
    cost: 'More energy per signal',
  },
};

export const PROVIDER_KEYS: Record<Provider, string> = {
  typesafe: 'TYPESAFE_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};
export const DEFAULT_GROUPS: ModelGroup[] = [
  {
    id: 'jev',
    species: 'rabbit',
    controller: 'model',
    population: 40,
    label: 'Jev',
    provider: 'typesafe',
    model: 'jev-1.13.0',
    color: 0,
    delayMs: 0,
  },
  {
    id: 'claude',
    species: 'rabbit',
    controller: 'model',
    population: 40,
    label: 'Claude Haiku',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    color: 1,
    delayMs: 0,
  },
  {
    id: 'wolves',
    wolfLifeCycle: 'dynamic',
    species: 'wolf',
    controller: 'deterministic',
    population: POPULATION_BUDGET.wolf,
    label: 'Deterministic wolves',
    provider: 'typesafe',
    model: 'jev-1.13.0',
    color: 2,
    delayMs: 0,
  },
];
// Lotka-Volterra-style predator–prey preset: rabbits breed on their own; wolves breed from kills
// and starve without them. Tuned headlessly for a ~2.5–3 minute cycle (LOTKA-VOLTERRA-SPEC.md).
export const PREDATOR_PREY_RULES: Rules = {
  ...RULES,
  shelterCount: 12,
  wolfSpacing: 8,
  wolfClearance: 4,
  maxPopulation: 250,
  rabbitCapacity: 160,
  reliefEnabled: 0,
  wolfSoloPups: 1,
  // Births don't hinge on meeting a mate: scattered survivors can still rebuild.
  rabbitSoloBirths: 1,
  shuffleDirections: 0,
  // Young animals leave home, and dense herds breed slowly: this keeps both species spread across
  // the map (the well-mixed assumption behind Lotka-Volterra) instead of one hidden herd.
  dispersalMin: 6,
  dispersalMax: 12,
  localCapacity: 0,
  wolfInterference: 1,
  // Off: scent found rabbits hiding in forest, so hiding no longer protected them and prey
  // collapsed. Dispersal already keeps rabbits spread out enough for wolves to find.
  wolfScent: 0,
  wolfScentRange: 12,
  passiveBreeding: 1,
  preyMateDistance: 8,
  // Rabbits (α): births are a population rate; food and water never limit them.
  maturity: 8,
  breedCooldown: 16,
  breedEnergy: 30,
  breedWater: 30,
  breedCost: 10,
  childEnergy: 60,
  childWater: 80,
  foodCapacity: 8,
  foodRegrowth: 0.1,
  foodEnergy: 5.5,
  baseMetabolism: 0.1,
  restMetabolism: 0.7,
  thirst: 0.1,
  forageBout: 1e9,
  // No old age: founders would all die at once. Prey deaths come from wolves, as in the model.
  lifespan: 1e9,
  // Predation (β): wolves catch any exposed rabbit they reach.
  wolfEncounterKills: 1,
  wolfSpeed: 1.6,
  wolfSight: 9,
  wolfCapture: 0.8,
  // Handling time + logistic prey (Rosenzweig–MacArthur) give cycles that persist.
  wolfEatCooldown: 10,
  // Wolf births (δ) come from kills; deaths (γ) from starvation and a short lifespan.
  wolfPopulationCap: 150,
  // Founders start fed but wait before their first pup, so wolves neither starve nor boom on arrival.
  wolfFounderEnergy: 50,
  wolfFounderPupDelay: 20,
  wolfChildEnergy: 33,
  wolfMetabolism: 1.2,
  wolfMovementCost: 0,
  wolfMealEnergy: 40,
  wolfMaturity: 5,
  wolfLifespan: 1e9,
  // Config C from the offline search (passed 10 of 24 fresh runs; see chat).
  wolfBreedEnergy: 80,
  wolfBreedCost: 30,
  wolfBreedCooldown: 10,
  // A steady trickle of migrants, whatever the numbers: real populations are open, and closed
  // small predator–prey systems collapse (Gause 1934, Huffaker 1958).
  migrationInterval: 20,
};
export function rulesFor(
  world: (Pick<World, 'scenario'> & Partial<Pick<World, 'experiment' | 'experiments'>>) | undefined,
): Rules {
  let base = world?.scenario === 'predatorPrey' ? PREDATOR_PREY_RULES : RULES;
  if (world?.experiments?.resources)
    base = {
      ...base,
      wolfMovementCost: 0.18,
      foodRegrowth: base.foodRegrowth * 0.5,
      droughtRegrowth: 0.001,
      droughtWither: 0.08,
      wolfMealEnergy: 0,
    };
  if (world?.experiments?.demographics)
    base = {
      ...base,
      rabbitSoloBirths: 0,
      wolfSoloPups: 0,
      maturity: 24,
      wolfMaturity: 45,
      lifespan: 480,
      wolfLifespan: 720,
      breedEnergy: 60,
      preyMateDistance: 1.7,
      wolfPairDistance: 1.7,
      rabbitCapacity: 0,
      localCapacity: 12,
      localCrowdRadius: 4,
      migrationInterval: 0,
    };
  const e = world?.experiment;
  if (!e?.appliedToSimulation || e.mode !== 'active') return base;
  const v = e.values;
  const cold = 1 + Math.max(0, 20 - v.temperature) * 0.02;
  const heat = 1 + Math.max(0, v.temperature - 20) * 0.04;
  const growth = Math.max(0.1, 1 - Math.abs(v.temperature - 20) * 0.025);
  const growthScale = (v.foodRegrowth / 100) * growth;
  const droughtStrength = v.disasterSeverity / 100;
  // Interpolate through the preset, so 100% preserves both of its drought rules.
  const droughtRegrowth =
    droughtStrength <= 1
      ? base.droughtRegrowth + (base.foodRegrowth - base.droughtRegrowth) * (1 - droughtStrength)
      : base.droughtRegrowth * Math.max(0, 2 - droughtStrength);
  return {
    ...base,
    baseMetabolism: base.baseMetabolism * cold,
    wolfMetabolism: base.wolfMetabolism * cold,
    thirst: base.thirst * heat,
    droughtThirst: base.droughtThirst * heat,
    foodRegrowth: base.foodRegrowth * growthScale,
    droughtRegrowth: droughtRegrowth * growthScale,
    droughtWither: base.droughtWither * droughtStrength,
    wolfSpeed: base.wolfSpeed * (v.wolfSpeed / 100),
    wolfSight: v.wolfVision,
    signalDelay: v.signalDelay / 1000,
    signalCost: v.signalCost,
  };
}
export const PREDATOR_PREY_BUDGET: Record<Species, number> = { rabbit: 80, wolf: 20 };
export const PREDATOR_PREY_GROUPS: ModelGroup[] = [
  // Like the textbook start: rabbits ~2x the measured balance (~34), wolves at it (~14). The
  // distance from balance sets how big the waves are; starting at balance gives only a wobble.
  { ...DEFAULT_GROUPS[0], label: 'Jev rabbits', population: 70 },
  {
    id: 'wolves',
    species: 'wolf',
    controller: 'model',
    wolfLifeCycle: 'dynamic',
    population: 8,
    label: 'Jev wolves',
    provider: 'typesafe',
    model: DEFAULT_GROUPS[0].model,
    color: 2,
    delayMs: 0,
  },
];
export const SCENARIO_CONFIG: Record<Scenario, RunConfig> = {
  arena: DEFAULT_CONFIG,
  predatorPrey: {
    ...DEFAULT_CONFIG,
    scenario: 'predatorPrey',
    timeScale: 2,
    maxInFlight: 6,
    maxRequests: 14000,
    maxSeconds: 600,
  },
};
export const MODEL_PRESETS: { label: string; provider: Provider; model: string }[] = [
  ...DEFAULT_GROUPS.filter((g) => g.species !== 'wolf').map(({ label, provider, model }) => ({
    label,
    provider,
    model,
  })),
  { label: 'Claude Sonnet 4.6', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { label: 'GPT-5.6 Luna', provider: 'openai', model: 'gpt-5.6-luna' },
  { label: 'Gemini 3.8 Flash', provider: 'google', model: 'gemini-3.8-flash' },
];
// Adding a group redistributes its species budget instead of adding predator pressure.
export function balancePopulations(
  groups: ModelGroup[],
  fixedId?: string,
  count?: number,
  onlySpecies?: Species,
): ModelGroup[] {
  const changed = groups.find((g) => g.id === fixedId);
  const affected = onlySpecies ?? (changed ? changed.species || 'rabbit' : undefined);
  return groups.map((g) => {
    const species = g.species || 'rabbit';
    if (affected && species !== affected) return g;
    const peers = groups.filter((p) => (p.species || 'rabbit') === species);
    const fixed = peers.find((p) => p.id === fixedId);
    const budget = POPULATION_BUDGET[species];
    const reserved =
      fixed && count !== undefined
        ? Math.max(1, Math.min(budget - peers.length + 1, Math.trunc(count) || 1))
        : undefined;
    if (reserved !== undefined && g.id === fixedId) return { ...g, population: reserved };
    const others = reserved === undefined ? peers : peers.filter((p) => p.id !== fixedId);
    const remaining = budget - (reserved || 0);
    const index = others.findIndex((p) => p.id === g.id);
    return {
      ...g,
      population:
        Math.floor(remaining / others.length) + (index < remaining % others.length ? 1 : 0),
    };
  });
}
// Validate a fresh roster before changing any running-world state. Return only known fields.
export function validateGroups(
  input: unknown,
  budget: Record<Species, number> = POPULATION_BUDGET,
): ModelGroup[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 6)
    throw new Error('Choose 1–6 animal groups.');
  const ids = new Set<string>();
  const colors = new Set<number>();
  const groups = input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid model group.');
    const g = value as ModelGroup;
    const species = g.species ?? 'rabbit';
    const controller = g.controller ?? 'model';
    if (g.wolfLifeCycle !== undefined && !['dynamic', 'fixed'].includes(g.wolfLifeCycle))
      throw new Error('Unknown wolf life cycle.');
    if (!['rabbit', 'wolf'].includes(species)) throw new Error('Unknown species.');
    if (
      !['model', 'deterministic'].includes(controller) ||
      (species === 'rabbit' && controller !== 'model')
    )
      throw new Error('Deterministic control is only available for wolves.');
    if (
      typeof g.id !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(g.id) ||
      ['constructor', 'prototype', '__proto__'].includes(g.id) ||
      ids.has(g.id)
    )
      throw new Error('Group IDs must be unique, short identifiers.');
    if (typeof g.label !== 'string' || !g.label.trim() || g.label.length > 40)
      throw new Error('Group name must be 1–40 characters.');
    if (!Object.hasOwn(PROVIDER_KEYS, g.provider)) throw new Error('Unknown model provider.');
    if (typeof g.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(g.model))
      throw new Error('Enter a valid model ID.');
    if (!Number.isInteger(g.color) || g.color < 0 || g.color > 5 || colors.has(g.color))
      throw new Error('Choose a different animal color for each group.');
    if (!Number.isInteger(g.delayMs) || g.delayMs < 0 || g.delayMs > 5000)
      throw new Error('Added delay must be 0–5000 ms.');
    ids.add(g.id);
    colors.add(g.color);
    return {
      id: g.id,
      label: g.label.trim(),
      provider: g.provider,
      model: g.model,
      color: g.color,
      delayMs: controller === 'deterministic' ? 0 : g.delayMs,
      species,
      controller,
      population: g.population,
      ...(species === 'wolf' ? { wolfLifeCycle: g.wolfLifeCycle ?? ('dynamic' as const) } : {}),
    };
  });
  if (!groups.some((g) => g.species === 'rabbit'))
    throw new Error('Keep at least one rabbit group.');
  const defaults = balancePopulations(groups);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    g.population ??= defaults[i].population;
    if (!Number.isInteger(g.population) || g.population! < 1 || g.population! > budget[g.species])
      throw new Error('Each group needs a positive starting population within its species budget.');
  }
  for (const species of ['rabbit', 'wolf'] as const) {
    if (
      groups.filter((g) => g.species === species).reduce((sum, g) => sum + g.population!, 0) >
      budget[species]
    )
      throw new Error(
        `Starting ${species} population exceeds the ${budget[species]}-animal budget.`,
      );
  }
  return groups;
}
