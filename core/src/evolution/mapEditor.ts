import { GRID, RULES } from './constants.js';
import {
  isTerrainStamp,
  TERRAIN_STAMP_SIZE,
  terrainStampIndices,
  terrainStampOrigin,
} from './terrain.js';
import type { Point, Tile, World } from './types.js';
import { center, distance, tileAt, walkable } from './world.js';

export const MAP_BRUSHES = ['grass', 'food', 'forest', 'water', 'mountain', 'shelter'] as const;
export type MapBrush = (typeof MAP_BRUSHES)[number];
export interface MapEdit extends Point {
  brush: MapBrush;
}
export function validateMapEdits(input: unknown): MapEdit[] {
  if (!Array.isArray(input) || !input.length || input.length > GRID * GRID)
    throw new Error('Paint between 1 and 4096 tiles.');
  const seen = new Set<number>();
  return input.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid tile edit.');
    const { x, y, brush } = item as MapEdit;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID || y >= GRID)
      throw new Error('Tile coordinates must be inside the habitat.');
    if (!MAP_BRUSHES.includes(brush)) throw new Error('Unknown terrain brush.');
    const key = y * GRID + x;
    if (seen.has(key)) throw new Error('A tile may only appear once per edit.');
    seen.add(key);
    return { x, y, brush };
  });
}
export function paintTile(tile: Tile, brush: MapBrush): Tile {
  const kind = brush === 'food' ? 'grass' : brush;
  return {
    ...tile,
    kind,
    food: brush === 'food' ? RULES.foodCapacity : 0,
    foodCapacity: brush === 'food' ? RULES.foodCapacity : 0,
    elevation: kind === 'mountain' ? 1 : 0,
    edited: true,
  };
}
export function brushBounds(point: Point, brush: MapBrush, size: number) {
  if (isTerrainStamp(brush)) {
    const { x, y } = terrainStampOrigin(point);
    return { left: x, top: y, right: x + TERRAIN_STAMP_SIZE, bottom: y + TERRAIN_STAMP_SIZE };
  }
  const radius = Math.floor(size / 2);
  return {
    left: Math.max(0, point.x - radius),
    top: Math.max(0, point.y - radius),
    right: Math.min(GRID, point.x + radius + 1),
    bottom: Math.min(GRID, point.y + radius + 1),
  };
}
// Produce a final tile patch shared by pointer painting and its hover preview.
// Painting over any part of an object removes it as a whole before placing terrain.
export function paintMapBrush(
  tiles: Tile[],
  points: Point[],
  brush: MapBrush,
  size: number,
): MapEdit[] {
  const targets = new Set<number>();
  for (const point of points) {
    const { left, top, right, bottom } = brushBounds(point, brush, size);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) targets.add(y * GRID + x);
  }
  const edits = new Map<number, MapEdit>();
  for (const i of targets) {
    if (!isTerrainStamp(tiles[i].kind) || tiles[i].kind === brush) continue;
    for (const index of terrainStampIndices(tiles[i])) {
      const tile = tiles[index];
      if (isTerrainStamp(tile.kind)) edits.set(index, { x: tile.x, y: tile.y, brush: 'grass' });
    }
  }
  for (const index of targets) {
    const { x, y } = tiles[index];
    edits.set(index, { x, y, brush });
  }
  return [...edits.values()];
}
// Work on a copy so invalid terrain can never partly modify a running world.
export function editWorldMap(world: World, edits: MapEdit[]): { world: World; relocated: number } {
  const next = structuredClone(world);
  for (const edit of edits) {
    const index = edit.y * GRID + edit.x;
    next.tiles[index] = paintTile(next.tiles[index], edit.brush);
  }
  // Reject partial objects from stale clients or direct API requests, too.
  const checked = new Set<number>();
  for (const edit of edits) {
    const index = edit.y * GRID + edit.x;
    if (!isTerrainStamp(edit.brush) && !isTerrainStamp(world.tiles[index].kind)) continue;
    const indices = terrainStampIndices(edit);
    if (isTerrainStamp(next.tiles[index].kind) && !indices.includes(index))
      throw new Error('Trees and mountains must occupy complete 3 × 3 stamps.');
    if (checked.has(indices[0])) continue;
    checked.add(indices[0]);
    for (const kind of ['forest', 'mountain'] as const) {
      const count = indices.filter((i) => next.tiles[i].kind === kind).length;
      if (count && count !== TERRAIN_STAMP_SIZE ** 2)
        throw new Error('Trees and mountains must occupy complete 3 × 3 stamps.');
    }
  }
  const animals = [...next.rabbits, ...next.wolves];
  const valid = (animal: (typeof animals)[number], p: Point) =>
    walkable(next, p) && ('genes' in animal || tileAt(next, p)?.kind !== 'shelter');
  const occupied = new Set(
    animals.filter((a) => valid(a, a)).map((a) => Math.floor(a.y) * GRID + Math.floor(a.x)),
  );
  let relocated = 0;
  for (const animal of animals) {
    if (!valid(animal, animal)) {
      const destination = next.tiles
        .filter((tile) => valid(animal, tile) && !occupied.has(tile.y * GRID + tile.x))
        .sort((a, b) => distance(center(a), animal) - distance(center(b), animal))[0];
      if (!destination) throw new Error('Leave enough land for every animal before applying.');
      Object.assign(animal, center(destination));
      occupied.add(destination.y * GRID + destination.x);
      relocated++;
    }
    animal.path = [];
    animal.target = undefined;
    animal.action = 'rest';
    animal.pending = false;
    animal.nextDecision = world.time;
    if ('genes' in animal) {
      animal.mateId = undefined;
      animal.followId = undefined;
      animal.recipientId = undefined;
      animal.forageUntil = undefined;
      animal.memory = [];
      animal.signalUntil = 0;
      animal.lastSignal = 'none';
    } else {
      animal.nextHunt = world.time;
      animal.mateId = undefined;
    }
  }
  // Keep existing cache IDs/food, remove demolished burrows, and create empty new caches.
  next.caches = next.caches.filter((cache) => tileAt(next, cache)?.kind === 'shelter');
  let cacheId = Math.max(-1, ...world.caches.map((c) => c.id)) + 1;
  for (const tile of next.tiles) {
    if (
      tile.kind === 'shelter' &&
      !next.caches.some((c) => Math.floor(c.x) === tile.x && Math.floor(c.y) === tile.y)
    )
      next.caches.push({ id: cacheId++, ...center(tile), food: 0 });
  }
  next.signals = [];
  next.mapRevision = (world.mapRevision || 0) + 1;
  return { world: next, relocated };
}
