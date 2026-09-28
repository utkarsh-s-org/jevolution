import type { Snapshot } from '../../../core/src/evolution/types.js';
import { readDeviceKeys } from './deviceKeys.js';

export const HOSTED = import.meta.env.VITE_ARENA_HOSTED === 'true';
class HostedClient {
  private worker = new Worker(new URL('./hosted.worker.ts', import.meta.url), { type: 'module' });
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private sequence = 0;
  snapshot: Snapshot | null = null;
  authenticated = false;
  constructor() {
    this.worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'snapshot') {
        this.snapshot = message.snapshot;
        this.authenticated = message.authenticated;
        for (const listener of this.listeners) listener(message.snapshot);
      } else {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error));
        else pending?.resolve(message.result);
      }
    };
    this.worker.onerror = () => {
      for (const pending of this.pending.values())
        pending.reject(new Error('Simulation worker stopped. Reload to recover.'));
      this.pending.clear();
    };
    void this.request('refresh').catch(() => {});
    window.addEventListener('storage', (event) => {
      if (event.key === 'jevolution.provider-keys.v1' || event.key === null)
        void this.request('refresh').catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.snapshot?.status.running)
        void this.request('pause', {
          reason: 'Tab hidden. Paused to stop unattended model calls.',
        });
    });
  }
  request<T = Snapshot>(action: string, data?: unknown): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({
        id,
        action,
        data: action === 'refresh' ? { keys: readDeviceKeys() } : data,
      });
    });
  }
  subscribe(listener: (snapshot: Snapshot) => void) {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
let client: HostedClient | undefined;
export function hostedClient() {
  return (client ??= new HostedClient());
}

export async function arenaRequest<T = Snapshot>(path: string, data?: unknown): Promise<T> {
  if (HOSTED) {
    if (path === 'control') {
      const { action, ...input } = data as Record<string, unknown>;
      return hostedClient().request<T>(String(action), input);
    }
    if (path.startsWith('replay/')) {
      const url = new URL(path, location.origin);
      return hostedClient().request<T>('replay', {
        index: Number(url.pathname.split('/').pop()),
        runId: url.searchParams.get('runId'),
      });
    }
    return hostedClient().request<T>(path, data);
  }
  const response = await fetch(
    `/api/arena/${path}`,
    data === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Simulation request failed');
  return result as T;
}
