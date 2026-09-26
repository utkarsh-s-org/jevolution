import { DEFAULT_CONFIG, DEFAULT_GROUPS, RULES } from '../../../core/src/evolution/constants.js';
import type { Snapshot } from '../../../core/src/evolution/types.js';
import { createWorld } from '../../../core/src/evolution/world.js';

export const PUBLIC_PREVIEW = import.meta.env.VITE_ARENA_PUBLIC_PREVIEW === 'true';

// A fresh, paused world, not fabricated model decisions or simulation results.
export function createPublicPreview(): Snapshot {
  const world = createWorld(271828, DEFAULT_GROUPS);
  return {
    world,
    decisions: {},
    status: {
      running: false,
      reason: 'Public preview. Live simulation backend is not connected.',
      ready: Object.fromEntries(world.groups.map((group) => [group.id, false])),
      models: Object.fromEntries(world.groups.map((group) => [group.id, group.model])),
      inFlight: Object.fromEntries(world.groups.map((group) => [group.id, 0])),
      backlog: Object.fromEntries(world.groups.map((group) => [group.id, 0])),
      config: { ...DEFAULT_CONFIG },
      runId: 'public-preview',
      connections: 0,
      estimatedCost: null,
      providerReady: { typesafe: false, anthropic: false, openai: false, google: false },
      replay: { frames: 0, intervalMs: RULES.tickMs },
    },
  };
}
