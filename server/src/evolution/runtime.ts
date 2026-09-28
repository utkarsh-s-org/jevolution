import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { rulesFor } from '../../../core/src/evolution/constants.js';
import { SimulationRuntime } from '../../../core/src/evolution/runtime.js';
import type { World } from '../../../core/src/evolution/types.js';
import {
  choose,
  defaultGroups,
  INSTRUCTIONS,
  instructionsFor,
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
  private logRoot: string;
  override report() {
    let provenance: unknown = null;
    try {
      provenance = JSON.parse(
        readFileSync(path.join(this.logRoot, `${this.runId}.provenance.json`), 'utf8'),
      );
    } catch {
      /* old runs can lack provenance */
    }
    return {
      ...super.report(),
      performance: { ...this.metrics, memory: process.memoryUsage() },
      provenance,
    };
  }
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
        let build: unknown = null;
        try {
          build = JSON.parse(
            readFileSync(path.join(process.cwd(), 'dist/arena-provenance.json'), 'utf8'),
          );
        } catch {
          /* unknown */
        }
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const rules = rulesFor(initial.world as World);
        writeFileSync(
          path.join(logRoot, `${runId}.provenance.json`),
          JSON.stringify(
            {
              actualGroupPrompts: Object.fromEntries(
                (initial.world as World).groups.map((g) => [
                  g.id,
                  instructionsFor(g.species === 'wolf', {
                    relief: !!rules.reliefEnabled,
                    predatorPrey: (initial.world as World).scenario === 'predatorPrey',
                    experiments: (initial.world as World).experiments,
                  }),
                ]),
              ),
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
            },
            null,
            2,
          ),
        );
      },
    });
    this.logRoot = logRoot;
  }
}
