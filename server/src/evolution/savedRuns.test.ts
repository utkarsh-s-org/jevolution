import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { changes, type Value } from '../../../core/src/evolution/replayCodec.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';
import { createWorld } from '../../../core/src/evolution/world.js';
import { decodeRunChunk, validRunId } from './savedRuns.js';
const id = '11111111-1111-4111-8111-111111111111';
const base = {
  world: createWorld(42),
  status: { runId: id, config: {}, estimatedCost: 0 },
} as Snapshot;
test('saved replay retains exact snapshots, config and decision traces', () => {
  const next = structuredClone(base);
  next.world.time = 2.5;
  next.world.rabbits[0].energy -= 2;
  next.decisions = { '1': [] } as Snapshot['decisions'];
  const chunk = {
    start: 0,
    base,
    changes: [changes(base as unknown as Value, next as unknown as Value)],
  };
  const decoded = decodeRunChunk(gzipSync(JSON.stringify(chunk)), id, 0);
  assert.deepEqual(decoded.last, JSON.parse(JSON.stringify(next)));
  assert.equal(decoded.frames, 2);
});
test('replay input rejects path traversal, malformed paths and prototype pollution', () => {
  assert.ok(validRunId(id));
  assert.ok(!validRunId('../bob/run'));
  for (const path of [['__proto__', 'polluted'], ['world', 'constructor', 'x'], [], ['world', 1]]) {
    const chunk = { start: 0, base, changes: [[[path, true]]] };
    assert.throws(() => decodeRunChunk(gzipSync(JSON.stringify(chunk)), id, 0));
  }
  assert.throws(() => decodeRunChunk(gzipSync('not-json'), id, 0));
  assert.throws(() =>
    decodeRunChunk(gzipSync(JSON.stringify({ start: 100, base, changes: [] })), id, 0),
  );
  assert.throws(() =>
    decodeRunChunk(
      gzipSync(JSON.stringify({ start: 0, base, changes: Array(100).fill([]) })),
      id,
      0,
    ),
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
