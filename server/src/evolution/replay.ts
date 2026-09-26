import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { RULES } from '../../../core/src/evolution/constants.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type Patch = [string[], Value?];
interface Chunk {
  start: number;
  base: Snapshot;
  changes: Patch[][];
}
const CHUNK_SIZE = 100;
// Deltas retain exact engine values. No simulation or model calls run during replay.
function changes(before: Value, after: Value, at: string[] = [], out: Patch[] = []): Patch[] {
  if (before === after) return out;
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) !== Array.isArray(after) ||
    (Array.isArray(before) && Array.isArray(after) && before.length !== after.length)
  ) {
    out.push([at, after]);
    return out;
  }
  const a = before as Record<string, Value>,
    b = after as Record<string, Value>;
  for (const key of Object.keys(a)) if (!Object.hasOwn(b, key)) out.push([[...at, key]]);
  for (const key of Object.keys(b)) {
    if (!Object.hasOwn(a, key)) out.push([[...at, key], b[key]]);
    else changes(a[key], b[key], [...at, key], out);
  }
  return out;
}
function apply(snapshot: Snapshot, patches: Patch[]) {
  for (const [keys, value] of patches) {
    let target = snapshot as unknown as Record<string, Value>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, Value>;
    const key = keys[keys.length - 1];
    if (value === undefined) delete target[key];
    else target[key] = structuredClone(value);
  }
}
export class ReplayStore {
  frames = 0;
  error?: string;
  private current?: Chunk;
  private previous?: Snapshot;
  private directory: string;
  private cached?: Chunk;
  constructor(
    root: string,
    readonly runId: string,
  ) {
    this.directory = path.join(root, `${runId}.replay`);
  }
  capture(snapshot: Snapshot) {
    if (this.error) return;
    try {
      const next = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
      if (!this.current || this.current.changes.length >= CHUNK_SIZE - 1) {
        this.flush();
        this.current = { start: this.frames, base: next, changes: [] };
      } else
        this.current.changes.push(
          changes(this.previous as unknown as Value, next as unknown as Value),
        );
      this.previous = next;
      this.frames++;
    } catch {
      this.error = 'Replay recording failed. Previously saved frames remain available.';
    }
  }
  flush() {
    if (!this.current || this.error) return;
    mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, `${this.current.start}.json.gz`);
    writeFileSync(`${file}.tmp`, gzipSync(JSON.stringify(this.current), { level: 1 }));
    renameSync(`${file}.tmp`, file);
    const manifest = path.join(this.directory, 'manifest.json');
    writeFileSync(
      `${manifest}.tmp`,
      JSON.stringify({ runId: this.runId, frames: this.frames, intervalMs: RULES.tickMs }),
    );
    renameSync(`${manifest}.tmp`, manifest);
  }
  get(index: number): Snapshot {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames)
      throw new Error('Replay frame is out of range.');
    const start = Math.floor(index / CHUNK_SIZE) * CHUNK_SIZE;
    let chunk =
      this.current?.start === start
        ? this.current
        : this.cached?.start === start
          ? this.cached
          : undefined;
    if (!chunk) {
      chunk = JSON.parse(
        gunzipSync(readFileSync(path.join(this.directory, `${start}.json.gz`))).toString(),
      ) as Chunk;
      this.cached = chunk;
    }
    const result = structuredClone(chunk.base);
    for (let i = 0; i < index - start; i++) apply(result, chunk.changes[i]);
    return result;
  }
}
