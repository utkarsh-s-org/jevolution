import { GRID } from '../../../core/src/evolution/constants.js';
import { isTerrainStamp, terrainStampAnchor } from '../../../core/src/evolution/terrain.js';
import type { Tile } from '../../../core/src/evolution/types.js';

export interface TerrainDecoration {
  row: number;
  column: number;
  width: number;
  height: number;
}
export const TREE_SPRITE = { row: 0, column: 0, width: 43, height: 52 };
export const MOUNTAIN_SPRITE = { row: 1, column: 0, width: 48, height: 49 };
export const BURROW_SPRITE = { row: 1, column: 1, width: 31, height: 23 };
// Both generated objects and editor stamps anchor at the bottom center of their
// fixed 3×3 footprint. Never anchor at the first painted tile in a block.
export function terrainDecorations(tiles: Tile[]): Map<number, TerrainDecoration> {
  const result = new Map<number, TerrainDecoration>();
  const slots = new Map<number, { forest: Tile[]; mountain: Tile[] }>();
  for (const tile of tiles) {
    const index = tile.y * GRID + tile.x;
    if (tile.kind === 'shelter') result.set(index, BURROW_SPRITE);
    else if (isTerrainStamp(tile.kind)) {
      const anchor = terrainStampAnchor(tile);
      const key = anchor.y * GRID + anchor.x;
      const slot = slots.get(key) || { forest: [], mountain: [] };
      slot[tile.kind].push(tile);
      slots.set(key, slot);
    } else if (tile.kind === 'grass' && tile.decor % 71 === 0)
      result.set(index, { row: 1, column: 3, width: 13, height: 10 });
  }
  for (const [index, slot] of slots) {
    // Old saved maps may contain mixed fragments in a slot. Render one object,
    // with the majority kind, instead of stacking a tree and a mountain.
    const forest = slot.forest.length > slot.mountain.length;
    const sample = (forest ? slot.forest : slot.mountain).reduce((a, b) =>
      a.y * GRID + a.x < b.y * GRID + b.x ? a : b,
    );
    result.set(index, forest ? { ...TREE_SPRITE, column: sample.decor % 2 } : MOUNTAIN_SPRITE);
  }
  return result;
}
