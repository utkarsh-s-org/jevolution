import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { rulesFor } from '../../../core/src/evolution/constants.js';
import { experimentReport } from '../../../core/src/evolution/reporting.js';
import { SimulationRuntime } from '../../../core/src/evolution/runtime.js';
import type { World } from '../../../core/src/evolution/types.js';
import {
  choose,
  defaultGroups,
  INSTRUCTIONS,
  MODEL_DEFAULTS,
  PREDATOR_PREY_WOLF_INSTRUCTIONS,
  PREY_INSTRUCTIONS,
  providerReadiness,
  WOLF_INSTRUCTIONS,
} from './models.js';
import { ReplayStore } from './replay.js';

// The local server and hosted browser use exactly the same scheduler and simulation rules.
export class ArenaRuntime extends SimulationRuntime {
  declare replay: ReplayStore;
  private readonly readProvenance: () => unknown;
  constructor(logRoot: string) {
    let runProvenance: unknown = null;
    super({
      id: randomUUID,
      choose,
      defaultGroups,
      providerReadiness,
      modelDefaults: MODEL_DEFAULTS,
      jevModel: () => process.env.JEV_MODEL,
      createReplay: (runId) => {
        runProvenance = null;
        return new ReplayStore(logRoot, runId);
      },
      record: (runId, event) => {
        mkdirSync(logRoot, { recursive: true });
        appendFileSync(path.join(logRoot, `${runId}.jsonl`), JSON.stringify(event) + '\n');
      },
      saveInitial: (runId, initial) => {
        mkdirSync(logRoot, { recursive: true });
        writeFileSync(path.join(logRoot, `${runId}.initial.json`), JSON.stringify(initial));
        let build: unknown = null;
        try {
          build = JSON.parse(
            readFileSync(path.join(process.cwd(), 'dist/arena-provenance.json'), 'utf8'),
          );
        } catch {
          /* unknown is explicit */
        }
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const rules = rulesFor(initial.world as World);
        runProvenance = {
          prompts: {
            PREY_INSTRUCTIONS,
            INSTRUCTIONS,
            WOLF_INSTRUCTIONS,
            PREDATOR_PREY_WOLF_INSTRUCTIONS,
          },
          build,
          configSha256: hash(initial.config),
          rules,
          rulesSha256: hash(rules),
          initialWorldSha256: hash(initial.world),
          node: process.version,
          recordedAt: new Date().toISOString(),
        };
        writeFileSync(
          path.join(logRoot, `${runId}.provenance.json`),
          JSON.stringify(runProvenance, null, 2),
        );
      },
    });
    this.readProvenance = () => runProvenance;
  }
  report() {
    return {
      ...experimentReport(this.snapshot()),
      performance: { ...this.metrics, memory: process.memoryUsage() },
      provenance: this.readProvenance(),
    };
  }
}
