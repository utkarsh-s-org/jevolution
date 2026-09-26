import { describe, expect, it } from 'vitest';

import { GRID } from '../../core/src/evolution/constants.js';
import type { Tile } from '../../core/src/evolution/types.js';
import { terrainDecorations } from '../src/evolution/terrainDecoration.js';

const tiles = (kind: Tile['kind'], edited: boolean) =>
  Array.from({ length: 9 }, (_, i) => ({
    x: i % 3,
    y: Math.floor(i / 3),
    kind,
    food: 0,
    foodCapacity: 0,
    elevation: 0,
    decor: 1,
    edited,
  }));
describe('shared terrain decoration', () => {
  it('uses identical full-size trees and mountains for generated and painted terrain', () => {
    for (const kind of ['forest', 'mountain'] as const) {
      const generated = terrainDecorations(tiles(kind, false));
      const painted = terrainDecorations(tiles(kind, true));
      expect(painted).toEqual(generated);
      expect(painted.size).toBe(1);
      expect(painted.get(2 * GRID + 1)).toMatchObject(
        kind === 'forest' ? { width: 43, height: 52 } : { width: 48, height: 49 },
      );
    }
  });
  it('uses fixed anchors even when legacy fragments touch opposite cell edges', () => {
    const patch = tiles('forest', true);
    const fragments = [
      { ...patch[0], x: 2, y: 2 },
      { ...patch[0], x: 3, y: 2 },
    ];
    const result = terrainDecorations(fragments);
    expect([...result.keys()]).toEqual([2 * GRID + 1, 2 * GRID + 4]);
    expect(terrainDecorations([...fragments].reverse())).toEqual(result);
    expect([...result.values()].every((d) => d.width === 43 && d.height === 52)).toBe(true);
  });
  it('does not stack trees and mountains in old mixed slots', () => {
    const patch = tiles('forest', true);
    patch[8].kind = 'mountain';
    const result = terrainDecorations(patch);
    expect(result.size).toBe(1);
    expect(result.get(2 * GRID + 1)).toMatchObject({ width: 43, height: 52 });
  });
});
