import { DEFAULT_GROUPS, RULES, validateGroups } from '../../../core/src/evolution/constants.js';
import { ProviderError } from '../../../core/src/evolution/providerError.js';
import { SimulationRuntime } from '../../../core/src/evolution/runtime.js';
import type { ModelGroup, Provider, Result, RunConfig } from '../../../core/src/evolution/types.js';
import { HostedReplay, HostedStorage } from './hostedReplay.js';

let ready: Record<Provider, boolean> = {
  typesafe: false,
  anthropic: false,
  openai: false,
  google: false,
};
let groups = DEFAULT_GROUPS;
let authenticated = false;
let initialized = false;
const storage = new HostedStorage();
const runtime = new SimulationRuntime({
  id: () => crypto.randomUUID(),
  defaultGroups: () => groups,
  modelDefaults: { jev: 'jev-1.13.0', claude: 'claude-haiku-4-5-20251001' },
  providerReadiness: () => ready,
  createReplay: (runId) => new HostedReplay(storage, runId),
  record: (runId, event) => storage.record(runId, event),
  saveInitial: (runId, initial) => storage.record(runId, { type: 'initial', ...initial }),
  choose: async (group, observation, signal, options) => {
    const response = await fetch('/api/arena/decision', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group, observation, options }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        authenticated = false;
        ready = { typesafe: false, anthropic: false, openai: false, google: false };
      }
      const error = new ProviderError(
        data.error || 'Model request failed',
        data.status || response.status,
        data.retryAfterMs || 0,
      );
      error.nativeResponse = data.nativeResponse;
      error.latencyMs = data.latencyMs;
      throw error;
    }
    return data as Result;
  },
});
const send = () => postMessage({ type: 'snapshot', snapshot: runtime.snapshot(), authenticated });
async function refresh() {
  const response = await fetch('/api/arena/session', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not connect to the model server.');
  const session = (await response.json()) as {
    authenticated: boolean;
    ready: typeof ready;
    groups: ModelGroup[];
  };
  authenticated = session.authenticated;
  ready = session.authenticated
    ? session.ready
    : { typesafe: false, anthropic: false, openai: false, google: false };
  groups = session.groups;
  if (!initialized) {
    runtime.world.groups = validateGroups(groups);
    initialized = true;
  }
  runtime.reason = authenticated
    ? 'Ready. Start to run real model decisions.'
    : 'Enter your run access code to start model calls.';
  send();
}
onmessage = async (event: MessageEvent) => {
  const { id, action, data = {} } = event.data;
  try {
    let result: unknown;
    if (action === 'refresh') await refresh();
    else if (action === 'start') {
      if (!authenticated) throw new Error('Unlock the simulation first.');
      runtime.start();
    } else if (action === 'pause') runtime.pause(data.reason);
    else if (action === 'drought') runtime.drought();
    else if (action === 'reset') {
      if (runtime.running) throw new Error('Pause before resetting.');
      runtime.reset(data.seed, data.config as RunConfig, data.groups);
    } else if (action === 'map') runtime.editMap(data.runId, data.revision, data.edits);
    else if (action === 'replay') {
      if (data.runId !== runtime.runId) throw new Error('Run changed. Return to latest.');
      result = { index: data.index, snapshot: await runtime.replay.get(data.index) };
    } else if (action === 'state' || action === 'export') result = runtime.snapshot();
    else throw new Error('Unknown simulation command.');
    send();
    postMessage({ id, result: result ?? runtime.snapshot() });
  } catch (error) {
    postMessage({
      id,
      error: error instanceof Error ? error.message : 'Simulation command failed',
    });
  }
};
setInterval(() => {
  if (storage.error && runtime.running) runtime.pause(storage.error);
  send();
}, RULES.snapshotMs);
void refresh().catch((error: Error) => {
  runtime.reason = error.message;
  send();
});
