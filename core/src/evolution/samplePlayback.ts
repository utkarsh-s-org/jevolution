import { apply, type Chunk, recordedFrame } from './replayCodec.js';
import { SAMPLE_CHUNK_SIZE, type SampleRun } from './sampleRun.js';
import type { Snapshot } from './types.js';

/** Playback never owns a SimulationRuntime and cannot make decisions or save user runs. */
export class SamplePlayback {
  index = 0;
  playing = false;
  loading = false;
  error = '';
  snapshot: Snapshot | null = null;
  private generation = 0;
  private chunks = new Map<number, Promise<Chunk>>();
  private nextAt = 0;
  readonly run: SampleRun;
  private loader: (run: SampleRun, start: number) => Promise<Chunk>;
  constructor(run: SampleRun, loader: (run: SampleRun, start: number) => Promise<Chunk>) {
    this.run = run;
    this.loader = loader;
  }
  private chunk(index: number) {
    const start = Math.floor(index / SAMPLE_CHUNK_SIZE) * SAMPLE_CHUNK_SIZE;
    let promise = this.chunks.get(start);
    if (!promise) {
      promise = this.loader(this.run, start).catch((error) => {
        this.chunks.delete(start);
        throw error;
      });
    }
    this.chunks.delete(start);
    this.chunks.set(start, promise);
    // Keep a small window of decompressed chunks, not an entire long recording in memory.
    if (this.chunks.size > 3) this.chunks.delete(this.chunks.keys().next().value!);
    return promise;
  }
  pause() {
    this.playing = false;
    this.generation++;
    this.loading = false;
  }
  async seek(index: number) {
    this.pause();
    if (!Number.isInteger(index) || index < 0 || index >= this.run.frames)
      throw new Error('Sample frame unavailable.');
    const generation = this.generation;
    this.loading = true;
    this.error = '';
    try {
      const chunk = await this.chunk(index);
      if (generation !== this.generation) return;
      this.snapshot = recordedFrame(chunk, index, this.run.frames);
      this.snapshot.status.reason = 'Sample recording. No API calls are made during playback.';
      this.index = index;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
  async play(now: number) {
    if (!this.snapshot || this.index >= this.run.frames - 1) {
      const generation = this.generation + 1; // seek increments once through pause().
      await this.seek(0);
      if (generation !== this.generation) return;
    }
    this.error = '';
    this.playing = true;
    this.nextAt = now + this.run.interval_ms;
  }
  async tick(now: number) {
    if (!this.playing || this.loading || now < this.nextAt || !this.snapshot) return;
    const generation = this.generation;
    const index = this.index + 1;
    if (index >= this.run.frames) {
      this.pause();
      return;
    }
    this.loading = true;
    try {
      const chunk = await this.chunk(index);
      if (generation !== this.generation) return;
      // Sequential playback applies just one delta, instead of rebuilding every prior frame.
      const previousTime = this.snapshot.world.time;
      const next = structuredClone(this.snapshot);
      if (index === chunk.start) this.snapshot = recordedFrame(chunk, index, this.run.frames);
      else {
        apply(next, chunk.changes[index - chunk.start - 1]);
        next.status.running = false;
        next.status.replay.frames = this.run.frames;
        this.snapshot = next;
      }
      const elapsed = this.snapshot.world.time - previousTime;
      this.index = index;
      this.nextAt = now + (elapsed > 0 ? elapsed * 1000 : this.run.interval_ms);
      if (index === this.run.frames - 1) this.playing = false;
      // Fetch only the next chunk, allowing playback to begin before the entire run downloads.
      if (index % SAMPLE_CHUNK_SIZE === SAMPLE_CHUNK_SIZE - 5 && index + 5 < this.run.frames)
        void this.chunk(index + 5).catch(() => {});
    } catch (error) {
      if (generation === this.generation) {
        this.playing = false;
        this.error = error instanceof Error ? error.message : 'Playback failed. Please retry.';
      }
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}
