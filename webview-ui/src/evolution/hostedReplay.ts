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
  ownerId = 'unassigned';
  private database: Promise<IDBDatabase>;
  error?: string;
  private queue: Promise<void> = Promise.resolve();
  private sequence = 0;
  constructor() {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('jevolution-runs', 2);
      request.onupgradeneeded = () => {
        for (const name of ['chunks', 'events', 'outbox'])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name);
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
    const scopedKey: IDBValidKey = [this.ownerId, ...(Array.isArray(key) ? key : [key])];
    this.queue = this.queue
      .then(async () => {
        const db = await this.database;
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(store, 'readwrite');
          transaction.objectStore(store).put(copy, scopedKey);
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
      const request = db
        .transaction(store)
        .objectStore(store)
        .get([this.ownerId, ...(Array.isArray(key) ? key : [key])]);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Recorded frame unavailable.'));
    });
  }
  async drain() {
    await this.queue;
    if (this.error) throw new Error(this.error);
  }
  async pending(): Promise<unknown[]> {
    await this.drain();
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const request = db
        .transaction('outbox')
        .objectStore('outbox')
        .getAll(IDBKeyRange.bound([this.ownerId], [this.ownerId, []]));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Local pending saves unavailable.'));
    });
  }
  async removePending(runId: string, start: number, changes: number) {
    await this.drain();
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const key = [this.ownerId, runId, start];
      const read = store.get(key);
      read.onsuccess = () => {
        if (read.result?.chunk?.changes.length === changes) store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Could not confirm local save.'));
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
  private onFlush?: (runId: string, chunk: Chunk) => void;
  constructor(
    storage: HostedStorage,
    runId: string,
    onFlush?: (runId: string, chunk: Chunk) => void,
  ) {
    this.storage = storage;
    this.onFlush = onFlush;
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
    if (this.current && !this.error) {
      this.storage.put('chunks', [this.runId, this.current.start], this.current);
      this.onFlush?.(this.runId, structuredClone(this.current));
    }
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
