import { DEFAULT_GROUPS, DEFAULT_SEED, RULES } from '../../../core/src/evolution/constants.js';
import { ProviderError } from '../../../core/src/evolution/providerError.js';
import type { Chunk } from '../../../core/src/evolution/replayCodec.js';
import { SimulationRuntime } from '../../../core/src/evolution/runtime.js';
import { SamplePlayback } from '../../../core/src/evolution/samplePlayback.js';
import { assertSampleCommand } from '../../../core/src/evolution/sampleRun.js';
import type { Provider, Result, RunConfig, Snapshot } from '../../../core/src/evolution/types.js';
import {
  chunkStart,
  compressedChunk,
  loadCloudChunk,
  recordedFrame,
  type SavedRun,
} from './cloudRuns.js';
import { HostedReplay, HostedStorage } from './hostedReplay.js';
import { loadSample, loadSampleChunk } from './samplePlayback.js';
let ready: Record<Provider, boolean> = {
  typesafe: false,
  anthropic: false,
  openai: false,
  google: false,
};
const groups = DEFAULT_GROUPS;
let authenticated = false;
let initialized = false;
let ownerId = '';
let archived: SavedRun | null = null;
let sampleMode = false;
let samplePlayer: SamplePlayback | null = null;
let sampleReason = '';
let sampleError = '';
let sampleGeneration = 0;
let samplePending: Promise<void> | null = null;
let archiveLatest: Snapshot | null = null;
let archiveChunk: Chunk | null = null;
let saveState = '';
let uploading = false;
let syncError = '';
let cloudEnabled = true;
const uploads = new Map<string, { runId: string; chunk: Chunk; owner: string }>();
const started = new Set<string>();
const queuedSizes = new Map<string, number>();
const storage = new HostedStorage();
function queueChunk(runId: string, chunk: Chunk) {
  if (!started.has(runId) || !ownerId || !cloudEnabled) return;
  const id = `${runId}/${chunk.start}`;
  if (queuedSizes.get(id) === chunk.changes.length) return;
  queuedSizes.set(id, chunk.changes.length);
  const item = { runId, chunk, owner: ownerId };
  storage.put('outbox', [runId, chunk.start], item);
  uploads.set(id, item);
  saveState = syncError || 'Saving run…';
  void sync();
}
async function sync(retry = false) {
  if (uploading || (syncError && !retry)) return;
  syncError = '';
  uploading = true;
  try {
    while (uploads.size) {
      const [id, item] = uploads.entries().next().value!;
      await storage.drain();
      const response = await fetch(
        `/api/arena/runs?runId=${item.runId}&start=${item.chunk.start}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/gzip', 'x-account-id': item.owner },
          body: await compressedChunk(item.chunk),
        },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Cloud save failed.');
      }
      if (uploads.get(id) === item) {
        // Remove only the version just uploaded; a newer flush remains queued.
        uploads.delete(id);
        await storage.removePending(item.runId, item.chunk.start, item.chunk.changes.length);
      }
    }
    saveState = started.size ? 'Saved to your account' : '';
  } catch (error) {
    syncError = `Not saved to cloud: ${error instanceof Error ? error.message : 'Connection lost.'} Local copy retained. Retry before leaving.`;
    saveState = syncError;
    if (runtime.running) runtime.pause('Cloud save failed. Retry saving before continuing.');
  } finally {
    uploading = false;
    send();
  }
}
const runtime = new SimulationRuntime({
  id: () => crypto.randomUUID(),
  defaultGroups: () => groups,
  jevModel: () => groups.find((g) => g.provider === 'typesafe')?.model,
  modelDefaults: { jev: 'jev-1.13.0', claude: 'claude-haiku-4-5-20251001' },
  providerReadiness: () => ready,
  createReplay: (runId) => new HostedReplay(storage, runId, queueChunk),
  record: (runId, event) => storage.record(runId, event),
  saveInitial: (runId, initial) => {
    started.add(runId);
    storage.record(runId, { type: 'initial', ...initial });
  },
  choose: async (group, observation, signal, options) => {
    const response = await fetch('/api/arena/decision', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'content-type': 'application/json', 'x-account-id': ownerId },
      body: JSON.stringify({ group, observation, options }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (
        [401, 402, 403].includes(data.status || response.status) ||
        data.code === 'credits_exhausted'
      ) {
        runtime.pause(data.error || 'Update your account API keys.');
        ready[group.provider] = false;
        void openSample(data.error || 'Your provider credits or API key need attention.').catch(
          () => {},
        );
      }
      const error = new ProviderError(
        data.error || 'Model request failed',
        data.status || response.status,
        data.retryAfterMs || 0,
      );
      error.latencyMs = data.latencyMs;
      throw error;
    }
    return data as Result;
  },
});
const send = () =>
  postMessage({
    type: 'snapshot',
    snapshot: archiveLatest || (sampleMode && samplePlayer?.snapshot) || runtime.snapshot(),
    sample: sampleMode && !archived,
    samplePlaying: !!samplePlayer?.playing && !archived,
    sampleIndex: samplePlayer?.index || 0,
    sampleReason,
    sampleError: sampleError || samplePlayer?.error || '',
    sampleLoading: sampleMode && (!samplePlayer?.snapshot || samplePlayer.loading),
    authenticated,
    archived: !!archived,
    saveState,
  });
async function openSample(reason = '') {
  sampleReason = reason;
  sampleMode = true; // Lock mutations immediately, including while download is pending or failed.
  runtime.pause('Sample mode. No live decisions.');
  samplePlayer?.pause();
  if (samplePlayer?.snapshot) {
    await samplePlayer.seek(samplePlayer.index);
    sampleError = '';
    send();
    return;
  }
  if (samplePending) return samplePending;
  const generation = ++sampleGeneration;
  sampleError = '';
  samplePending = (async () => {
    try {
      const player = new SamplePlayback(await loadSample(), loadSampleChunk);
      await player.seek(0);
      if (generation === sampleGeneration) samplePlayer = player;
    } catch (error) {
      if (generation === sampleGeneration)
        sampleError = error instanceof Error ? error.message : 'Sample unavailable.';
      throw error;
    } finally {
      if (generation === sampleGeneration) samplePending = null;
      send();
    }
  })();
  send();
  return samplePending;
}
function leaveSample() {
  sampleGeneration++;
  samplePlayer?.pause();
  sampleMode = false;
  samplePending = null;
  sampleError = '';
}
async function refresh() {
  if (runtime.running) runtime.pause('Account settings updated.');
  const response = await fetch('/api/arena/session');
  const data = await response.json();
  if (!response.ok) {
    authenticated = false;
    if (response.status === 401) {
      await openSample();
      return;
    }
    throw new Error(data.error || 'Log in to continue.');
  }
  if (ownerId && ownerId !== data.user.id) throw new Error('Account changed. Reload this page.');
  ownerId = data.user.id;
  storage.ownerId = ownerId;
  ready = data.ready;
  authenticated = true;
  if (!initialized) {
    runtime.reset(DEFAULT_SEED, runtime.config, groups);
    initialized = true;
    for (const value of await storage.pending()) {
      const item = value as { runId: string; chunk: Chunk; owner: string };
      if (item.owner === ownerId) uploads.set(`${item.runId}/${item.chunk.start}`, item);
    }
    void sync();
  }
  runtime.reason = 'Configure your habitat and account API keys, then start.';
  if (!Object.values(ready).some(Boolean)) await openSample();
  else leaveSample();
  send();
}
onmessage = async (event: MessageEvent) => {
  const { id, action, data = {} } = event.data;
  try {
    let result: unknown;
    if (sampleMode && !archived) assertSampleCommand(action);
    if (action === 'refresh') await refresh();
    else if (action === 'samplePlay') {
      if (!sampleMode || archived || !samplePlayer) throw new Error('Sample not ready.');
      await samplePlayer.play(performance.now());
    } else if (action === 'samplePause') samplePlayer?.pause();
    else if (action === 'sampleSeek') {
      if (!sampleMode || archived || !samplePlayer) throw new Error('Sample not ready.');
      await samplePlayer.seek(data.index);
    } else if (action === 'sampleRetry') await openSample(sampleReason);
    else if (action === 'retrySave') {
      await sync(true);
      if (syncError) throw new Error(syncError);
    } else if (action === 'openSaved') {
      if (runtime.running) throw new Error('Pause the current simulation first.');
      await sync(true);
      if (syncError) throw new Error(syncError);
      samplePlayer?.pause();
      const run = data.run as SavedRun;
      if (run.user_id !== ownerId || !run.frames) throw new Error('Saved run unavailable.');
      const chunk = await loadCloudChunk(run.id, chunkStart(run.frames - 1), ownerId);
      const latest = recordedFrame(chunk, run.frames - 1, run.frames);
      archived = run;
      archiveChunk = chunk;
      archiveLatest = latest;
    } else if (action === 'closeSaved') {
      archived = null;
      archiveLatest = null;
      archiveChunk = null;
    } else if (action === 'start') {
      if (archived)
        throw new Error('Saved runs are read-only. Return to your current habitat first.');
      if (!authenticated) throw new Error('Log in first.');
      if (syncError) throw new Error('Retry saving before starting.');
      runtime.start();
    } else if (action === 'pause') {
      samplePlayer?.pause();
      runtime.pause(data.reason);
      await sync(true);
    } else if (action === 'drought') {
      if (archived) throw new Error('Saved runs are read-only.');
      runtime.drought();
    } else if (action === 'reset') {
      if (archived) throw new Error('Return to current habitat first.');
      if (runtime.running) throw new Error('Pause before resetting.');
      await sync(true);
      if (syncError) throw new Error(syncError);
      runtime.reset(data.seed, data.config as RunConfig, data.groups);
    } else if (action === 'map') {
      if (archived) throw new Error('Saved runs are read-only.');
      runtime.editMap(data.runId, data.revision, data.edits);
    } else if (action === 'replay') {
      if (archived) {
        if (data.runId !== archived.id) throw new Error('Saved run changed.');
        const start = chunkStart(data.index);
        if (archiveChunk?.start !== start)
          archiveChunk = await loadCloudChunk(archived.id, start, ownerId);
        result = {
          index: data.index,
          snapshot: recordedFrame(archiveChunk, data.index, archived.frames),
        };
      } else if (sampleMode) {
        if (!samplePlayer || data.runId !== samplePlayer.run.id) throw new Error('Sample changed.');
        await samplePlayer.seek(data.index);
        result = { index: samplePlayer.index, snapshot: samplePlayer.snapshot };
      } else {
        if (data.runId !== runtime.runId) throw new Error('Run changed. Return to latest.');
        result = { index: data.index, snapshot: await runtime.replay.get(data.index) };
      }
    } else if (action === 'state' || action === 'export')
      result = archiveLatest || (sampleMode && samplePlayer?.snapshot) || runtime.snapshot();
    else if (action === 'logout') {
      samplePlayer?.pause();
      runtime.pause('Signed out.');
      await sync(true);
      if (syncError) throw new Error(syncError);
      cloudEnabled = false;
    } else throw new Error('Unknown simulation command.');
    send();
    postMessage({
      id,
      result:
        result ??
        archiveLatest ??
        (sampleMode ? samplePlayer?.snapshot : null) ??
        runtime.snapshot(),
    });
  } catch (error) {
    postMessage({
      id,
      error: error instanceof Error ? error.message : 'Simulation command failed',
    });
  }
};
setInterval(async () => {
  if (sampleMode && !archived) await samplePlayer?.tick(performance.now());
  if (storage.error && runtime.running) runtime.pause(storage.error);
  send();
}, RULES.snapshotMs);
setInterval(() => {
  if (initialized && started.has(runtime.runId)) runtime.replay.flush();
}, 5000);
