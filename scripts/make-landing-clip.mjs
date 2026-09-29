// Cuts a short clip from a real recorded run for the landing page card. Replay only: no model calls.
// Usage: node scripts/make-landing-clip.mjs RUN_ID [START_FRAME] [FRAMES] [STEP]
// STEP keeps every Nth recorded frame; playback slows to match, so the clip keeps its length.
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';

const [runId, startArg = '1840', countArg = '160', stepArg = '2'] = process.argv.slice(2);
if (!runId)
  throw new Error('Usage: node scripts/make-landing-clip.mjs RUN_ID [START_FRAME] [FRAMES] [STEP]');
const start = Number(startArg),
  count = Number(countArg),
  step = Number(stepArg);
const dir = path.join('logs/evolution', `${runId}.replay`);

function frame(index) {
  const chunkStart = Math.floor(index / 100) * 100;
  const chunk = JSON.parse(gunzipSync(readFileSync(path.join(dir, `${chunkStart}.json.gz`))));
  const snapshot = structuredClone(chunk.base);
  for (let i = 0; i < index - chunkStart; i++)
    for (const [keys, value] of chunk.changes[i]) {
      let target = snapshot;
      for (const key of keys.slice(0, -1)) target = target[key];
      if (value === undefined) delete target[keys.at(-1)];
      else target[keys.at(-1)] = value;
    }
  return snapshot;
}
// Only what the habitat renderer draws.
const KEEP = [
  'time',
  'seed',
  'scenario',
  'groups',
  'signals',
  'reliefEvents',
  'carcasses',
  'caches',
  'droughtUntil',
];
// Fields the renderer reads; positions rounded to 1/100 tile so the clip stays small.
const ANIMAL = [
  'id',
  'lineage',
  'x',
  'y',
  'face',
  'action',
  'cargo',
  'energy',
  'pending',
  'lastSignal',
  'signalUntil',
];
const SIGNAL = ['kind', 'x', 'y', 'delivered', 'expires', 'range', 'sender', 'lineage'];
const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const pick = (o, keys) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, round(o[k])]));
const animal = (a) => ({
  ...pick(a, ANIMAL),
  // First waypoint only: enough for the walking animation.
  path: (a.path ?? []).slice(0, 1).map((p) => pick(p, ['x', 'y'])),
});
const slim = (w) => ({
  ...Object.fromEntries(KEEP.filter((k) => k in w).map((k) => [k, w[k]])),
  signals: w.signals.map((x) => pick(x, SIGNAL)),
  rabbits: w.rabbits.map(animal),
  wolves: w.wolves.map(animal),
});
const first = frame(start).world;
const clip = {
  source: {
    runId,
    startFrame: start,
    frames: count,
    note: 'Recorded Jev rabbits vs Jev wolves; replayed, not simulated.',
  },
  intervalMs: 50 * step,
  tiles: first.tiles,
  frames: Array.from({ length: Math.ceil(count / step) }, (_, i) =>
    slim(frame(start + i * step).world),
  ),
};
const out = 'webview-ui/public/evolution/landing-clip.json';
writeFileSync(out, JSON.stringify(clip));
console.log(
  out,
  (JSON.stringify(clip).length / 1024) | 0,
  'KB',
  'time',
  clip.frames[0].time.toFixed(1),
  '→',
  clip.frames.at(-1).time.toFixed(1),
);
