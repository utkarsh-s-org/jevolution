import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import sampleApi from '../../../api/arena/sample.js';
import { changes, type Chunk, type Value } from '../../../core/src/evolution/replayCodec.js';
import { SamplePlayback } from '../../../core/src/evolution/samplePlayback.js';
import { assertSampleCommand, type SampleRun } from '../../../core/src/evolution/sampleRun.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';

const run: SampleRun = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Test sample',
  frames: 23,
  interval_ms: 500,
  duration_seconds: 11,
  recorded_at: '2026-09-25T00:00:00Z',
  notes: '',
};
const frame = (index: number) =>
  ({
    world: {
      time: index / 2,
      rabbits: [{ id: 1, energy: 100 - index }],
      history: [{ time: index / 2 }],
    },
    status: { runId: run.id, running: true, replay: { frames: index + 1, intervalMs: 500 } },
    decisions: {
      '1': [
        {
          id: `decision-${index}`,
          decision: { choice: 'rest', signal: 'none' },
          simulationTime: index / 2,
        },
      ],
    },
  }) as unknown as Snapshot;
function chunk(start: number): Chunk {
  const frames = Array.from({ length: Math.min(20, run.frames - start) }, (_, i) =>
    frame(start + i),
  );
  return {
    start,
    base: frames[0],
    changes: frames
      .slice(1)
      .map((next, i) => changes(frames[i] as unknown as Value, next as unknown as Value)),
  };
}
test('sample playback advances across chunks, preserves decisions, pauses, seeks and restarts', async () => {
  const requests: number[] = [];
  const player = new SamplePlayback(run, async (_run, start) => {
    requests.push(start);
    return chunk(start);
  });
  await player.seek(0);
  await player.play(0);
  await player.tick(499);
  assert.equal(player.index, 0);
  for (let i = 1; i < run.frames; i++) await player.tick(i * 500);
  assert.equal(player.index, 22);
  assert.equal(player.playing, false);
  assert.equal(player.snapshot?.status.running, false);
  assert.deepEqual(player.snapshot?.decisions, frame(22).decisions);
  assert.deepEqual(player.snapshot?.world.history, frame(22).world.history);
  await player.play(12000);
  assert.equal(player.index, 0);
  player.pause();
  await player.tick(13000);
  assert.equal(player.index, 0);
  await player.seek(9);
  assert.equal(player.snapshot?.world.rabbits[0].energy, 91);
  assert.equal(player.playing, false);
  assert.deepEqual(requests, [0, 20]);
  await assert.rejects(player.seek(-1));
  await assert.rejects(player.seek(run.frames));
});
test('a stale download cannot overwrite a newer seek', async () => {
  let finish!: (value: Chunk) => void;
  const player = new SamplePlayback(run, async (_run, start) =>
    start === 0
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : chunk(start),
  );
  const first = player.seek(0);
  await player.seek(22);
  finish(chunk(0));
  await first;
  assert.equal(player.index, 22);
});
test('network failure pauses playback and allows a retry without running any engine', async () => {
  let unavailable = true;
  const player = new SamplePlayback(run, async (_run, start) => {
    if (start === 20 && unavailable) throw new Error('Offline');
    return chunk(start);
  });
  await player.seek(19);
  await player.play(0);
  await player.tick(500);
  assert.equal(player.playing, false);
  assert.equal(player.error, 'Offline');
  unavailable = false;
  await player.seek(20);
  assert.equal(player.error, '');
});
test('sample mode rejects live simulation mutations', () => {
  for (const action of ['start', 'reset', 'map', 'drought'])
    assert.throws(() => assertSampleCommand(action), /recorded sample/);
  for (const action of ['samplePlay', 'samplePause', 'sampleSeek', 'refresh', 'openSaved'])
    assert.doesNotThrow(() => assertSampleCommand(action));
});
test('sample API is public read-only and cannot retrieve arbitrary users recordings', async () => {
  const originalFetch = globalThis.fetch;
  const originalURL = process.env.SUPABASE_URL,
    originalKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    paths.push(url);
    return url.includes('/rest/') ? Response.json([run]) : new Response('gzip');
  };
  try {
    for (const method of ['POST', 'DELETE', 'PATCH'])
      assert.equal(
        (await sampleApi.fetch(new Request('https://site.test/api/arena/sample', { method })))
          .status,
        405,
      );
    assert.equal(paths.length, 0);
    assert.deepEqual(
      await (await sampleApi.fetch(new Request('https://site.test/api/arena/sample'))).json(),
      run,
    );
    for (const query of [
      'id=other&start=0',
      `id=${run.id}&start=-1`,
      `id=${run.id}&start=23`,
      `id=${run.id}&start=1`,
      `id=${run.id}&start=../user`,
    ])
      assert.equal(
        (await sampleApi.fetch(new Request(`https://site.test/api/arena/sample?${query}`))).status,
        404,
      );
    assert.equal(paths.filter((p) => p.includes('/storage/')).length, 0);
    assert.equal(
      (
        await sampleApi.fetch(
          new Request(`https://site.test/api/arena/sample?id=${run.id}&start=20`),
        )
      ).status,
      200,
    );
    assert.ok(paths.at(-1)?.endsWith(`/jevolution-samples/${run.id}/20.json.gz`));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalURL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalURL;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalKey;
  }
});
