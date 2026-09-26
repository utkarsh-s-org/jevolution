import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { RULES } from '../../../core/src/evolution/constants.js';
import {
  apply,
  changes,
  type Chunk,
  CHUNK_SIZE,
  type Value,
} from '../../../core/src/evolution/replayCodec.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';

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
