// Offline curator tool. Reads an existing recording; never starts a simulation or calls a model.
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { apply, changes, type Chunk, type Value } from '../core/src/evolution/replayCodec.js';
import { SAMPLE_CHUNK_SIZE } from '../core/src/evolution/sampleRun.js';
import type { Snapshot } from '../core/src/evolution/types.js';
import { decodeRunChunk } from '../server/src/evolution/savedRuns.js';
const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw new Error(
    'Usage: node --import tsx scripts/prepare-sample.ts SOURCE_REPLAY_DIRECTORY OUTPUT_DIRECTORY',
  );
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
mkdirSync(destination, { recursive: true });
// Two samples per second retains the original world values and decision records.
const stride = 10;
let output: Chunk | undefined, previous: Snapshot | undefined;
let frames = 0,
  duration = 0,
  byteCount = 0,
  decisions = 0;
function flush() {
  if (!output) return;
  const raw = JSON.stringify(output);
  // Refuse accidental credentials or personal account fields before making a sample public.
  if (
    /"(?:api_key|apiKey|access_token|refresh_token|ciphertext|password|email)"\s*:|sk-ant-|sb_secret_|Bearer eyJ/.test(
      raw,
    )
  )
    throw new Error('Potential sensitive data found. Review recording before publishing.');
  const bytes = gzipSync(raw, { level: 9 });
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Sample chunk exceeds upload limit.');
  decodeRunChunk(bytes, manifest.runId, output.start);
  byteCount += bytes.length;
  writeFileSync(join(destination, `${output.start}.json.gz`), bytes);
}
for (let start = 0; start < manifest.frames; start += 100) {
  const chunk = JSON.parse(
    gunzipSync(readFileSync(join(source, `${start}.json.gz`)), {
      maxOutputLength: 128 * 1024 * 1024,
    }).toString(),
  ) as Chunk;
  const frame = structuredClone(chunk.base);
  for (let offset = 0; offset <= chunk.changes.length; offset++) {
    if (offset) apply(frame, chunk.changes[offset - 1]);
    const index = start + offset;
    if (index % stride !== 0 && index !== manifest.frames - 1) continue;
    const recorded = structuredClone(frame);
    recorded.status.running = false;
    recorded.status.connections = 0;
    recorded.status.reason = 'Sample recording. Playback uses no API credits.';
    recorded.status.ready = {};
    recorded.status.providerReady = {
      typesafe: false,
      anthropic: false,
      openai: false,
      google: false,
    };
    recorded.status.replay = { frames: 0, intervalMs: stride * manifest.intervalMs };
    if (frames % SAMPLE_CHUNK_SIZE === 0) {
      flush();
      output = { start: frames, base: recorded, changes: [] };
    } else
      output!.changes.push(changes(previous as unknown as Value, recorded as unknown as Value));
    previous = recorded;
    duration = recorded.world.time;
    decisions = Object.values(recorded.decisions || {}).reduce((n, traces) => n + traces.length, 0);
    frames++;
  }
}
flush();
writeFileSync(
  join(destination, 'manifest.json'),
  JSON.stringify(
    {
      id: manifest.runId,
      title: 'Jev and Claude in a shared habitat',
      recorded_at: statSync(join(source, 'manifest.json')).mtime.toISOString(),
      frames,
      interval_ms: stride * manifest.intervalMs,
      duration_seconds: duration,
      notes:
        'A prerecorded run with Jev and Claude rabbits and deterministic wolves. Older frames may not contain response JSON. Playback is sampled at 2 frames per second; values and recorded decisions are unchanged.',
    },
    null,
    2,
  ),
);
console.log({ frames, duration, finalDecisionTraces: decisions, megabytes: byteCount / 1e6 });
