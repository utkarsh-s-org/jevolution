import {
  apply,
  changes,
  type Chunk,
  CHUNK_SIZE,
  type Value,
} from '../../../core/src/evolution/replayCodec.js';
import type { RuntimeReplay } from '../../../core/src/evolution/runtimePorts.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';

export class HostedStorage {
  private database: Promise<IDBDatabase>;
  error?: string;
  private queue: Promise<void> = Promise.resolve();
  private sequence = 0;
  constructor() {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('jevolution-runs', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('chunks');
        request.result.createObjectStore('events');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Browser storage unavailable.'));
    });
    void this.database.catch(() => {
      this.error = 'Browser storage unavailable.';
    });
  }
  put(store: string, key: IDBValidKey, value: unknown) {
    if (this.error) throw new Error(this.error);
    // Capture values now: the live world continues mutating while IndexedDB opens.
    const copy = structuredClone(value);
    this.queue = this.queue
      .then(async () => {
        const db = await this.database;
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(store, 'readwrite');
          transaction.objectStore(store).put(copy, key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(new Error('Browser storage is full or unavailable.'));
          transaction.onabort = () => reject(new Error('Browser storage write was interrupted.'));
        });
      })
      .catch((error: Error) => {
        this.error = error.message;
      });
  }
  async get(store: string, key: IDBValidKey): Promise<unknown> {
    await this.queue;
    if (this.error) throw new Error(this.error);
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Recorded frame unavailable.'));
    });
  }
  record(runId: string, event: Record<string, unknown>) {
    this.put('events', [runId, this.sequence++], event);
  }
}

export class HostedReplay implements RuntimeReplay {
  frames = 0;
  error?: string;
  private current?: Chunk;
  private previous?: Snapshot;
  private storage: HostedStorage;
  private runId: string;
  constructor(storage: HostedStorage, runId: string) {
    this.storage = storage;
    this.runId = runId;
  }
  capture(snapshot: Snapshot) {
    if (this.error) return;
    try {
      if (this.storage.error) throw new Error(this.storage.error);
      const next = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
      if (!this.current || this.current.changes.length >= CHUNK_SIZE - 1) {
        this.flush();
        this.current = { start: this.frames, base: next, changes: [] };
      } else {
        this.current.changes.push(
          changes(this.previous as unknown as Value, next as unknown as Value),
        );
      }
      this.previous = next;
      this.frames++;
    } catch {
      this.error = 'Replay recording stopped: browser storage is unavailable. Export this run.';
    }
  }
  flush() {
    if (this.current && !this.error)
      this.storage.put('chunks', [this.runId, this.current.start], this.current);
  }
  async get(index: number): Promise<Snapshot> {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames)
      throw new Error('Replay frame is out of range.');
    const start = Math.floor(index / CHUNK_SIZE) * CHUNK_SIZE;
    const chunk =
      this.current?.start === start
        ? this.current
        : ((await this.storage.get('chunks', [this.runId, start])) as Chunk | undefined);
    if (!chunk) throw new Error('Replay frame unavailable.');
    const result = structuredClone(chunk.base);
    for (let i = 0; i < index - start; i++) apply(result, chunk.changes[i]);
    return result;
  }
}
