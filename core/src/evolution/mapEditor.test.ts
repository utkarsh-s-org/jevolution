import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { ArenaRuntime } from '../../../server/src/evolution/runtime.js';
import { GRID, RULES } from './constants.js';
import {
  editWorldMap,
  MAP_BRUSHES,
  paintMapBrush,
  paintTile,
  validateMapEdits,
} from './mapEditor.js';
import { brushBounds } from './mapEditor.js';
import { isTerrainStamp, terrainStampIndices } from './terrain.js';
import { createWorld, tileAt, walkable } from './world.js';

test('map input rejects malformed, duplicate, oversized and out-of-bounds changes', () => {
  for (const input of [
    null,
    [],
    [{ x: -1, y: 0, brush: 'grass' }],
    [{ x: 1.5, y: 0, brush: 'water' }],
    [{ x: 0, y: GRID, brush: 'forest' }],
    [{ x: 0, y: 0, brush: 'lava' }],
    [null],
    Array(4097).fill({ x: 0, y: 0, brush: 'grass' }),
    Array(2).fill({ x: 0, y: 0, brush: 'grass' }),
  ])
    assert.throws(() => validateMapEdits(input));
  assert.equal(validateMapEdits([{ x: 0, y: 0, brush: 'water' }]).length, 1);
});
test('all brushes have consistent terrain/resources; animals safely relocate and paths are cleared', () => {
  const world = createWorld(58);
  const before = structuredClone(world);
  const rabbit = world.rabbits[0],
    wolf = world.wolves[0];
  const blocked = [rabbit, wolf].map((a) => ({
    x: Math.floor(a.x),
    y: Math.floor(a.y),
    brush: 'water' as const,
  }));
  const edits = validateMapEdits([
    ...blocked,
    ...MAP_BRUSHES.flatMap((brush, x) =>
      paintMapBrush(world.tiles, [{ x: x * 6, y: 0 }], brush, 1),
    ),
  ]);
  rabbit.path = [{ x: 4, y: 4 }];
  wolf.path = [{ x: 3, y: 3 }];
  const result = editWorldMap(world, edits);
  assert.equal(result.world.mapRevision, 1);
  assert.ok(result.relocated >= 2);
  for (const a of [...result.world.rabbits, ...result.world.wolves]) {
    assert.equal(walkable(result.world, a), true);
    assert.deepEqual(a.path, []);
    assert.equal(a.action, 'rest');
  }
  assert.ok(result.world.wolves.every((w) => tileAt(result.world, w)?.kind !== 'shelter'));
  for (const [x, brush] of MAP_BRUSHES.entries()) {
    const tile = result.world.tiles[x * 6];
    assert.equal(tile.kind, brush === 'food' ? 'grass' : brush);
    assert.equal(tile.food, brush === 'food' ? RULES.foodCapacity : 0);
    assert.equal(tile.foodCapacity, tile.food);
  }
  assert.deepEqual(result.world.stats, before.stats);
  assert.equal(result.world.rabbits.length, world.rabbits.length);
  assert.equal(result.world.wolves.length, world.wolves.length);
  assert.deepEqual(world.tiles, before.tiles, 'original world is not mutated');
  assert.equal(result.world.time, world.time);
});
test('destroying burrows removes their stores; surviving caches retain IDs and food; new stores are empty', () => {
  const world = createWorld(91);
  world.caches[0].food = 12;
  world.caches[1].food = 6;
  const removed = world.caches[0],
    retained = world.caches[1];
  const result = editWorldMap(
    world,
    validateMapEdits([
      { x: Math.floor(removed.x), y: Math.floor(removed.y), brush: 'grass' },
      ...paintMapBrush(world.tiles, [{ x: 0, y: 0 }], 'shelter', 1),
    ]),
  ).world;
  assert.ok(!result.caches.some((c) => c.id === removed.id));
  assert.deepEqual(
    result.caches.find((c) => c.id === retained.id),
    retained,
  );
  assert.equal(result.caches.find((c) => c.x === 0.5 && c.y === 0.5)?.food, 0);
});
test('uninhabitable maps fail atomically; runtime rejects running/stale edits and records paused edits in replay', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'map-edit-test-'));
  const runtime = new ArenaRuntime(dir);
  try {
    const before = structuredClone(runtime.snapshot());
    const edits = paintMapBrush(runtime.world.tiles, [{ x: 0, y: 0 }], 'water', 1);
    runtime.running = true;
    assert.throws(() => runtime.editMap(runtime.runId, 0, edits), /Pause/);
    runtime.running = false;
    assert.throws(() => runtime.editMap('old-run', 0, edits), /changed/);
    assert.throws(() => runtime.editMap(runtime.runId, 1, edits), /changed/);
    assert.throws(
      () =>
        runtime.editMap(
          runtime.runId,
          0,
          runtime.world.tiles.map(({ x, y }) => ({ x, y, brush: 'water' })),
        ),
      /enough land/,
    );
    assert.deepEqual(runtime.world, before.world);
    const frame = runtime.replay.frames - 1;
    runtime.editMap(runtime.runId, 0, edits);
    assert.equal(runtime.running, false);
    assert.equal(runtime.world.tiles[0].kind, 'water');
    assert.equal(runtime.world.mapRevision, 1);
    assert.equal(runtime.replay.frames, frame + 2);
    assert.deepEqual(runtime.replay.get(frame).world, JSON.parse(JSON.stringify(before.world)));
    assert.equal(runtime.replay.get(frame + 1).world.tiles[0].kind, 'water');
    assert.throws(() => runtime.editMap(runtime.runId, 0, edits), /changed/);
    assert.ok(Object.values(runtime.world.stats).every((s) => s.requested === 0));
  } finally {
    runtime.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tree and mountain strokes snap to whole non-overlapping objects, including map edges', () => {
  const world = createWorld(42);
  world.tiles = world.tiles.map((t) => paintTile(t, 'grass'));
  for (const brush of ['forest', 'mountain'] as const) {
    const edits = paintMapBrush(
      world.tiles,
      [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 63, y: 63 },
      ],
      brush,
      1,
    );
    assert.equal(edits.length, 27);
    const next = editWorldMap(world, edits).world;
    for (const p of [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 63, y: 63 },
    ])
      assert.ok(terrainStampIndices(p).every((i) => next.tiles[i].kind === brush));
    assert.deepEqual(brushBounds({ x: 63, y: 63 }, brush, 5), {
      left: 61,
      top: 61,
      right: 64,
      bottom: 64,
    });
    assert.throws(() => editWorldMap(world, [{ x: 2, y: 2, brush }]), /complete 3/);
    assert.throws(() => editWorldMap(world, [...edits, { x: 60, y: 63, brush }]), /complete 3/);
    const erased = paintMapBrush(next.tiles, [{ x: 1, y: 1 }], 'water', 1);
    assert.equal(erased.length, 9);
    const cleared = editWorldMap(next, erased).world;
    assert.equal(cleared.tiles[GRID + 1].kind, 'water');
    assert.ok(
      terrainStampIndices({ x: 1, y: 1 }).every((i) => !isTerrainStamp(cleared.tiles[i].kind)),
    );
    assert.throws(() => editWorldMap(next, [{ x: 1, y: 1, brush: 'grass' }]), /complete 3/);
  }
});
