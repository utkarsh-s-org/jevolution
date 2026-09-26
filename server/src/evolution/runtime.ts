import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { SimulationRuntime } from '../../../core/src/evolution/runtime.js';
import { choose, defaultGroups, MODEL_DEFAULTS, providerReadiness } from './models.js';
import { ReplayStore } from './replay.js';

// The local server and hosted browser use exactly the same scheduler and simulation rules.
export class ArenaRuntime extends SimulationRuntime {
  declare replay: ReplayStore;
  constructor(logRoot: string) {
    super({
      id: randomUUID,
      choose,
      defaultGroups,
      providerReadiness,
      modelDefaults: MODEL_DEFAULTS,
      jevModel: () => process.env.JEV_MODEL,
      createReplay: (runId) => new ReplayStore(logRoot, runId),
      record: (runId, event) => {
        mkdirSync(logRoot, { recursive: true });
        appendFileSync(path.join(logRoot, `${runId}.jsonl`), JSON.stringify(event) + '\n');
      },
      saveInitial: (runId, initial) => {
        mkdirSync(logRoot, { recursive: true });
        writeFileSync(path.join(logRoot, `${runId}.initial.json`), JSON.stringify(initial));
      },
    });
  }
}
