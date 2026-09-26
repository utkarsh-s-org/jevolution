import {
  DEFAULT_GROUPS,
  DEFAULT_SEED,
  GENE_NAMES,
  GRID,
  PREDATOR_PREY_BUDGET,
  RULES,
  rulesFor,
  validateGroups,
} from './constants.js';
import { alignTerrainStamps, terrainStampIndices } from './terrain.js';
import type {
  Genes,
  Lineage,
  LineageStats,
  ModelGroup,
  Point,
  Rabbit,
  Scenario,
  Tile,
  Wolf,
  World,
} from './types.js';

export function random(world: { rng: number }): number {
  let x = world.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  world.rng = x >>> 0;
  return world.rng / 4294967296;
}
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const cell = (p: Point) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
export const center = (p: Point) => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
export function tileAt(world: World, p: Point): Tile | undefined {
  const c = cell(p);
  return c.x >= 0 && c.y >= 0 && c.x < GRID && c.y < GRID
    ? world.tiles[c.y * GRID + c.x]
    : undefined;
}
export function walkable(world: World, p: Point): boolean {
  const t = tileAt(world, p);
  return !!t && t.kind !== 'water' && t.kind !== 'mountain';
}
export function visible(world: World, a: Point, b: Point, radius: number): boolean {
  if (distance(a, b) > radius) return false;
  const steps = Math.max(1, Math.ceil(distance(a, b) * 2));
  let forest = 0;
  let previous = '';
  for (let i = 1; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    const t = tileAt(world, p);
    if (!t || t.kind === 'mountain') return false;
    const key = `${t.x},${t.y}`;
    if (key !== previous && t.kind === 'forest') forest++;
    previous = key;
    if (forest > 2 && distance(a, b) > 3) return false;
  }
  return true;
}

// Same four-neighbor BFS movement contract as Pixel Agents' office/layout/tileMap.ts.
// Kept in core because both the server and canvas need a DOM-free ecosystem model.
export function findRoute(world: World, from: Point, to: Point): Point[] {
  if (!walkable(world, to)) return [];
  const a = cell(from);
  const b = cell(to);
  const start = a.y * GRID + a.x;
  const end = b.y * GRID + b.x;
  const parent = new Int32Array(GRID * GRID).fill(-1);
  parent[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === end) {
      const path: Point[] = [];
      for (let key = end; key !== start; key = parent[key])
        path.push({ x: (key % GRID) + 0.5, y: Math.floor(key / GRID) + 0.5 });
      return path.reverse();
    }
    const x = at % GRID;
    const y = Math.floor(at / GRID);
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const p = { x: x + dx, y: y + dy };
      if (!walkable(world, p)) continue;
      const key = p.y * GRID + p.x;
      if (parent[key] !== -1) continue;
      parent[key] = at;
      queue.push(key);
    }
  }
  return [];
}
export function addEvent(
  world: World,
  kind: 'birth' | 'death' | 'signal' | 'system',
  text: string,
  lineage?: Lineage,
) {
  world.events.unshift({ id: world.eventId++, time: world.time, kind, text, lineage });
  world.events.length = Math.min(world.events.length, RULES.eventLimit);
}
function emptyStats(): LineageStats {
  return {
    kills: 0,
    relief: {
      deliveries: 0,
      foodShared: 0,
      urgentFed: 0,
      deposited: 0,
      withdrawn: 0,
      responses: [],
    },
    behavior: { offered: 0, followed: 0, other: 0 },
    births: 0,
    deaths: 0,
    predation: 0,
    starvation: 0,
    dehydration: 0,
    oldAge: 0,
    requested: 0,
    applied: 0,
    late: 0,
    invalid: 0,
    errors: 0,
    cancelled: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencies: [],
    queueMs: [],
    food: 0,
    signals: 0,
  };
}
export function createRabbit(
  world: World,
  lineage: Lineage,
  p: Point,
  genes: Genes,
  generation = 0,
  parents: number[] = [],
): Rabbit {
  const RULES = rulesFor(world);
  return {
    id: world.nextId++,
    lineage,
    ...center(p),
    genes: { ...genes },
    energy: generation ? RULES.childEnergy : RULES.founderEnergy,
    water: generation ? RULES.childWater : RULES.founderWater,
    age: generation ? 0 : RULES.maturity,
    generation,
    parents,
    action: 'rest',
    cargo: 0,
    nextHelpSignal: 0,
    path: [],
    cooldown: generation ? RULES.maturity : 8,
    nextDecision: 0,
    pending: false,
    face: lineage === 'jev' ? 1 : -1,
    lastLatency: null,
    lastSignal: 'none',
    signalUntil: 0,
    born: world.time,
    memory: [],
    nextFollow: 0,
    behavior: { offered: 0, followed: 0, other: 0 },
  };
}

export function createWolf(
  world: World,
  lineage: Lineage,
  position: Point,
  parents: Wolf[] = [],
): Wolf {
  const RULES = rulesFor(world);
  return {
    id: world.nextId++,
    lineage,
    ...center(position),
    action: 'rest',
    path: [],
    nextDecision: world.time,
    pending: false,
    lastLatency: null,
    cooldown: parents.length ? 0 : 8,
    nextHunt: world.time,
    face: 1,
    energy: parents.length ? RULES.wolfChildEnergy : RULES.wolfFounderEnergy,
    age: parents.length ? 0 : RULES.wolfMaturity,
    generation: parents.length ? Math.max(...parents.map((p) => p.generation ?? 0)) + 1 : 0,
    parents: parents.map((p) => p.id),
    born: world.time,
    reproductionCooldown: parents.length ? 0 : RULES.wolfFounderPupDelay,
  };
}

function shuffle<T>(world: World, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(world) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function connectLand(world: World) {
  const neighbors = (key: number) => {
    const x = key % GRID;
    const y = Math.floor(key / GRID);
    const result: number[] = [];
    if (x > 0) result.push(key - 1);
    if (x < GRID - 1) result.push(key + 1);
    if (y > 0) result.push(key - GRID);
    if (y < GRID - 1) result.push(key + GRID);
    return result;
  };
  const land = (key: number) => walkable(world, world.tiles[key]);
  const seen = new Set<number>();
  let largest: number[] = [];
  for (let key = 0; key < world.tiles.length; key++) {
    if (seen.has(key) || !land(key)) continue;
    const component = [key];
    seen.add(key);
    for (let head = 0; head < component.length; head++)
      for (const next of neighbors(component[head]))
        if (!seen.has(next) && land(next)) {
          seen.add(next);
          component.push(next);
        }
    if (component.length > largest.length) largest = component;
  }
  const connected = new Set(largest);
  let landCount = seen.size;
  while (connected.size < landCount) {
    // Search outward from all connected land at once. The first other land
    // component needs the shortest gap through rock/water, not a perimeter road.
    const queue = [...connected];
    const parent = new Int32Array(GRID * GRID).fill(-1);
    for (const key of queue) parent[key] = key;
    let target = -1;
    for (let head = 0; head < queue.length && target === -1; head++)
      for (const next of neighbors(queue[head])) {
        if (parent[next] !== -1) continue;
        parent[next] = queue[head];
        queue.push(next);
        if (land(next)) {
          target = next;
          break;
        }
      }
    if (target === -1) throw new Error('Could not connect habitat land');
    for (let key = target; !connected.has(key); key = parent[key]) {
      if (land(key)) continue;
      // Opening a mountain pass removes the whole object, never a fragment.
      const indices =
        world.tiles[key].kind === 'mountain'
          ? [...new Set([...terrainStampIndices(world.tiles[key]), key])]
          : [key];
      for (const index of indices) {
        if (land(index)) continue;
        const tile = world.tiles[index];
        tile.kind = 'grass';
        tile.food = 0;
        tile.foodCapacity = 0;
        tile.elevation = 0;
        landCount++;
      }
    }
    const added = [target];
    connected.add(target);
    for (let head = 0; head < added.length; head++)
      for (const next of neighbors(added[head]))
        if (!connected.has(next) && land(next)) {
          connected.add(next);
          added.push(next);
        }
  }
}

function generateTerrain(world: World) {
  // Warm up the seeded generator so nearby small seeds also produce distinct geography.
  for (let i = 0; i < 8; i++) random(world);
  const range = (min: number, max: number) => min + random(world) * (max - min);
  const patch = (minRadius: number, maxRadius: number) => {
    const rx = range(minRadius, maxRadius);
    const ry = range(minRadius, maxRadius);
    return {
      x: range(0, GRID - 1),
      y: range(0, GRID - 1),
      rx,
      ry,
      phase: range(0, Math.PI * 2),
    };
  };
  const contains = (p: ReturnType<typeof patch>, x: number, y: number) => {
    const dx = (x - p.x) / p.rx;
    const dy = (y - p.y) / p.ry;
    const angle = Math.atan2(dy, dx);
    const edge = 1 + Math.sin(angle * 3 + p.phase) * 0.15 + Math.cos(angle * 5 - p.phase) * 0.1;
    return Math.hypot(dx, dy) < edge;
  };
  const lakes = [
    patch(6, 10),
    ...Array.from({ length: 2 + Math.floor(random(world) * 3) }, () => patch(2, 5)),
  ];
  const ridges = Array.from({ length: 3 + Math.floor(random(world) * 3) }, () => patch(3, 6));
  const forests = Array.from({ length: 5 + Math.floor(random(world) * 4) }, () => patch(4, 9));
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const kind: Tile['kind'] = lakes.some((p) => contains(p, x, y))
        ? 'water'
        : ridges.some((p) => contains(p, x, y))
          ? 'mountain'
          : forests.some((p) => contains(p, x, y))
            ? 'forest'
            : 'grass';
      world.tiles.push({
        x,
        y,
        kind,
        food: kind === 'grass' ? 3 + random(world) * 5 : kind === 'forest' ? 2 : 0,
        foodCapacity: 0,
        elevation: kind === 'mountain' ? 1 + Math.floor(random(world) * 3) : 0,
        decor: Math.floor(random(world) * 100),
      });
    }

  alignTerrainStamps(world.tiles);

  // Retain isolated land by opening small passes or land bridges only where needed.
  connectLand(world);

  const shelters: Tile[] = [];
  for (const t of shuffle(
    world,
    world.tiles.filter(
      (t) => t.kind === 'grass' && t.x > 3 && t.x < GRID - 4 && t.y > 3 && t.y < GRID - 4,
    ),
  )) {
    if (shelters.some((s) => distance(s, t) < 8)) continue;
    t.kind = 'shelter';
    t.food = 0;
    shelters.push(t);
    if (shelters.length === rulesFor(world).shelterCount) break;
  }
}

function populateFood(world: World) {
  // A separate seeded stream keeps resource generation independent of animal placement.
  const rng = { rng: (world.seed ^ 0x9e3779b9) >>> 0 || 1 };
  const sites = world.tiles.filter((t) => t.kind === 'grass' || t.kind === 'forest');
  for (let i = sites.length - 1; i > 0; i--) {
    const j = Math.floor(random(rng) * (i + 1));
    [sites[i], sites[j]] = [sites[j], sites[i]];
  }
  const patchCount = 12 + Math.floor(random(rng) * 5);
  const patches: {
    x: number;
    y: number;
    rx: number;
    ry: number;
    quality: number;
    phase: number;
  }[] = [];
  for (const site of sites) {
    if (patches.some((p) => distance(p, site) < 8)) continue;
    patches.push({
      x: site.x,
      y: site.y,
      rx: 4 + random(rng) * 4,
      ry: 4 + random(rng) * 4,
      quality: 0.7 + random(rng) * 0.3,
      phase: random(rng) * Math.PI * 2,
    });
    if (patches.length === patchCount) break;
  }
  for (const tile of world.tiles) {
    tile.food = 0;
    tile.foodCapacity = 0;
    if (tile.kind !== 'grass' && tile.kind !== 'forest') continue;
    let fertility = 0;
    for (const p of patches) {
      const dx = (tile.x - p.x) / p.rx;
      const dy = (tile.y - p.y) / p.ry;
      const edge = 1 + 0.15 * Math.sin(Math.atan2(dy, dx) * 3 + p.phase);
      fertility = Math.max(fertility, (1 - (dx * dx + dy * dy) / (edge * edge)) * p.quality);
    }
    if (fertility < 0.12) continue;
    tile.foodCapacity =
      rulesFor(world).foodCapacity * fertility * (tile.kind === 'forest' ? 0.45 : 1);
    tile.food = tile.foodCapacity * (0.65 + random(rng) * 0.35);
  }
}

export function createWorld(
  seed = DEFAULT_SEED,
  roster: ModelGroup[] = DEFAULT_GROUPS,
  scenario: Scenario = 'arena',
): World {
  const predatorPrey = scenario === 'predatorPrey';
  const rules = rulesFor({ scenario });
  const groups = validateGroups(roster, predatorPrey ? PREDATOR_PREY_BUDGET : undefined);
  const rabbitGroups = groups.filter((g) => g.species === 'rabbit');
  const wolfGroups = groups.filter((g) => g.species === 'wolf');
  const founders = Math.max(...rabbitGroups.map((g) => g.population!));
  const wolfCount = wolfGroups.reduce((sum, g) => sum + g.population!, 0);
  const world: World = {
    ...(predatorPrey ? { scenario } : {}),
    groups,
    seed,
    rng: seed >>> 0 || 1,
    time: 0,
    tiles: [],
    rabbits: [],
    wolves: [],
    signals: [],
    stats: Object.fromEntries(groups.map((g) => [g.id, emptyStats()])),
    events: [],
    history: [],
    nextId: 1,
    eventId: 1,
    droughtUntil: 0,
    lastSample: 0,
    caches: [],
    reliefEvents: [],
    nextReliefId: 1,
  };
  generateTerrain(world);
  world.caches = world.tiles
    .filter((t) => t.kind === 'shelter')
    .map((t, id) => ({
      id,
      ...center(t),
      food: 0,
    }));
  const grass = world.tiles.filter(
    (t) => t.kind === 'grass' && t.x > 1 && t.x < GRID - 2 && t.y > 1 && t.y < GRID - 2,
  );
  const wolfPositions: Point[] = [];
  for (const p of wolfCount ? shuffle(world, [...grass]) : []) {
    if (wolfPositions.some((w) => distance(w, p) < rules.wolfSpacing)) continue;
    wolfPositions.push(p);
    if (wolfPositions.length === wolfCount) break;
  }
  const positions = shuffle(
    world,
    grass.filter((p) => wolfPositions.every((w) => distance(w, p) >= rules.wolfClearance)),
  );
  let positionIndex = 0;
  for (let i = 0; i < founders; i++) {
    const genes = Object.fromEntries(
      GENE_NAMES.map((k) => [k, 0.2 + random(world) * 0.6]),
    ) as Genes;
    // Equal founding trait distributions; independent locations across the entire habitat.
    for (const group of rabbitGroups) {
      if (i >= group.population!) continue;
      const rabbit = createRabbit(world, group.id, positions[positionIndex++], genes);
      rabbit.nextDecision = i * 0.08;
      world.rabbits.push(rabbit);
    }
  }
  let wolfIndex = 0;
  for (const group of wolfGroups)
    for (let i = 0; i < group.population!; i++) {
      const p = wolfPositions[wolfIndex++];
      const wolf = createWolf(world, group.id, p);
      wolf.nextDecision = i * 0.08;
      world.wolves.push(wolf);
    }
  populateFood(world);
  world.history.push({
    time: 0,
    populations: Object.fromEntries(groups.map((g) => [g.id, g.population!])),
    generation: 0,
  });
  addEvent(
    world,
    'system',
    `${world.rabbits.length} rabbits · matched founder gene sequence · random terrain and spawns · ${world.wolves.length} wolves`,
  );
  return world;
}

export function groupPopulation(world: World, group: ModelGroup): number {
  return (group.species === 'wolf' ? world.wolves : world.rabbits).filter(
    (a) => a.lineage === group.id,
  ).length;
}
/** Juvenile dispersal: send a newborn walking to open ground a few tiles from home. */
export function disperse(world: World, animal: Rabbit | Wolf) {
  const RULES = rulesFor(world);
  if (!RULES.dispersalMax) return;
  const start = { x: animal.x, y: animal.y };
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = random(world) * Math.PI * 2;
    const reach = RULES.dispersalMin + random(world) * (RULES.dispersalMax - RULES.dispersalMin);
    const target = center({
      x: Math.max(1, Math.min(GRID - 2, start.x + Math.cos(angle) * reach)),
      y: Math.max(1, Math.min(GRID - 2, start.y + Math.sin(angle) * reach)),
    });
    if (!walkable(world, target) || tileAt(world, target)?.kind === 'shelter') continue;
    const route = findRoute(world, animal, target);
    if (!route.length) continue;
    animal.path = route;
    animal.action = 'explore';
    animal.target = undefined;
    // Decide again after arriving (walking ~1.2 tiles per second).
    animal.nextDecision = world.time + distance(start, target) / 1.2;
    return;
  }
}
const DIRECTIONS = [
  [1, 0, 'east'],
  [-1, 0, 'west'],
  [0, 1, 'south'],
  [0, -1, 'north'],
] as const;
/** The four movement directions, shuffled when the scenario asks for it. */
export function directions(world: World) {
  const list = [...DIRECTIONS];
  if (!rulesFor(world).shuffleDirections) return list;
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random(world) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
