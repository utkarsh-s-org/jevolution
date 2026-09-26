import { GRID } from './constants.js';
import type { Point, Tile } from './types.js';

export const TERRAIN_STAMP_SIZE = 3;
// Leave the extra tile before the final slot so complete objects can still reach
// every map edge. The final slot is one tile farther from its neighbor.
const STAMP_ORIGINS = Array.from({ length: Math.floor(GRID / TERRAIN_STAMP_SIZE) }, (_, i) =>
  i === Math.floor(GRID / TERRAIN_STAMP_SIZE) - 1
    ? GRID - TERRAIN_STAMP_SIZE
    : i * TERRAIN_STAMP_SIZE,
);
export function isTerrainStamp(kind: string): kind is 'forest' | 'mountain' {
  return kind === 'forest' || kind === 'mountain';
}
// Every object uses a complete slot, including clicks along the last row/column.
export function terrainStampOrigin(point: Point): Point {
  const snap = (value: number) =>
    STAMP_ORIGINS[
      Math.max(0, Math.min(STAMP_ORIGINS.length - 1, Math.floor(value / TERRAIN_STAMP_SIZE)))
    ];
  return { x: snap(point.x), y: snap(point.y) };
}
export function terrainStampIndices(point: Point): number[] {
  const { x, y } = terrainStampOrigin(point);
  return Array.from(
    { length: TERRAIN_STAMP_SIZE ** 2 },
    (_, i) => (y + Math.floor(i / TERRAIN_STAMP_SIZE)) * GRID + x + (i % TERRAIN_STAMP_SIZE),
  );
}
export function terrainStampAnchor(point: Point): Point {
  const { x, y } = terrainStampOrigin(point);
  return { x: x + 1, y: y + 2 };
}
// Keep lakes organic; forests and mountains are built from the same whole objects
// users place. The center chooses the object, and lakes take priority at shorelines.
export function alignTerrainStamps(tiles: Tile[]): void {
  for (const y of STAMP_ORIGINS)
    for (const x of STAMP_ORIGINS) {
      const indices = terrainStampIndices({ x, y });
      const center = tiles[(y + 1) * GRID + x + 1];
      const kind =
        !indices.some((i) => tiles[i].kind === 'water') && isTerrainStamp(center.kind)
          ? center.kind
          : 'grass';
      for (const i of indices) {
        const tile = tiles[i];
        if (tile.kind === 'water') continue;
        tile.kind = kind;
        tile.elevation = kind === 'mountain' ? 1 : 0;
      }
    }
  const covered = new Set(
    STAMP_ORIGINS.flatMap((start) =>
      Array.from({ length: TERRAIN_STAMP_SIZE }, (_, i) => start + i),
    ),
  );
  for (const tile of tiles)
    if ((!covered.has(tile.x) || !covered.has(tile.y)) && isTerrainStamp(tile.kind)) {
      tile.kind = 'grass';
      tile.elevation = 0;
    }
}
