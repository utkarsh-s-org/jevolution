import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { SimulationRuntime } from '../../../core/src/evolution/runtime.js';
import { CONTRACT, ESCAPE_CONTRACT } from './a2aProtocol.js';
import { A2ATransport } from './a2aTransport.js';
import { RunBudget } from './budget.js';
import { FoodCoordinator } from './coordination.js';
import { EscapeCoordinator } from './escapeCoordination.js';
import { choose, defaultGroups, MODEL_DEFAULTS, providerReadiness } from './models.js';
import { ReplayStore } from './replay.js';

// The scheduler remains shared with hosted mode; only Node service adapters live here.
export class ArenaRuntime extends SimulationRuntime {
  declare replay: ReplayStore;
  constructor(logRoot: string) {
    let transport: A2ATransport | undefined;
    super({
      id: randomUUID,
      choose: (group, observation, signal, options) =>
        transport && options.cooperation
          ? transport.choose(group, observation, signal, options)
          : choose(group, observation, signal, options),
      defaultGroups,
      providerReadiness,
      modelDefaults: MODEL_DEFAULTS,
      jevModel: () => process.env.JEV_MODEL,
      createBudget: () => new RunBudget(),
      createCoordination: async ({ mode, runId, world, record, onFailure }) => {
        transport = undefined;
        const predatorPrey = world().scenario === 'predatorPrey';
        let coordinator: FoodCoordinator | EscapeCoordinator | undefined;
        if (mode === 'a2a') {
          transport = new A2ATransport(
            (event, worker) => {
              coordinator?.onWorkerEvent(event, worker);
              if (coordinator?.error) onFailure(coordinator.error);
            },
            (message) => {
              if (coordinator) coordinator.error = message;
              onFailure(message);
            },
            predatorPrey ? ESCAPE_CONTRACT : CONTRACT,
          );
          try {
            await transport.start();
          } catch (error) {
            transport.dispose();
            transport = undefined;
            throw error;
          }
        }
        const Coordinator = predatorPrey ? EscapeCoordinator : FoodCoordinator;
        coordinator = new Coordinator(mode, runId, world, record, transport);
        return coordinator;
      },
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
