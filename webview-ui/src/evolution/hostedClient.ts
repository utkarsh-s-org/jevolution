import type { Snapshot } from '../../../core/src/evolution/types.js';

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
  archived = false;
  sample = false;
  samplePlaying = false;
  sampleIndex = 0;
  sampleReason = '';
  sampleError = '';
  sampleLoading = false;
  saveState = '';
  private visibility = () => {
    if (document.hidden && (this.snapshot?.status.running || this.samplePlaying))
      void this.request('pause', {
        reason: 'Tab hidden. Paused to stop unattended model calls.',
      }).catch(() => {});
  };
  private leaving = (event: BeforeUnloadEvent) => {
    if (
      this.snapshot?.status.running ||
      this.saveState.startsWith('Saving') ||
      this.saveState.startsWith('Not saved')
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  constructor() {
    this.worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'snapshot') {
        this.snapshot = message.snapshot;
        this.authenticated = message.authenticated;
        this.archived = message.archived;
        this.sample = message.sample;
        this.samplePlaying = message.samplePlaying;
        this.sampleIndex = message.sampleIndex;
        this.sampleReason = message.sampleReason;
        this.sampleError = message.sampleError;
        this.sampleLoading = message.sampleLoading;
        this.saveState = message.saveState;
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
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('beforeunload', this.leaving);
  }
  request<T = Snapshot>(action: string, data?: unknown): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({
        id,
        action,
        data,
      });
    });
  }
  destroy() {
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('beforeunload', this.leaving);
    this.worker.terminate();
    this.listeners.clear();
    for (const pending of this.pending.values()) pending.reject(new Error('Signed out.'));
    this.pending.clear();
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

export function closeHostedClient() {
  client?.destroy();
  client = undefined;
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
