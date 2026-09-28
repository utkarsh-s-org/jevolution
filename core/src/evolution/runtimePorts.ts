import type { ModelGroup, ModelObservation, Provider, Result, Snapshot } from './types.js';

export interface RuntimeReplay {
  frames: number;
  error?: string;
  capture(snapshot: Snapshot): void;
  flush(): void;
  get(index: number): Snapshot | Promise<Snapshot>;
}

export interface RuntimeServices {
  id(): string;
  defaultGroups(): ModelGroup[];
  modelDefaults: { jev: string; claude: string };
  jevModel?(): string | undefined;
  providerReadiness(): Record<Provider, boolean>;
  choose(
    group: ModelGroup,
    observation: ModelObservation,
    signal: AbortSignal,
    options: {
      relief: boolean;
      predatorPrey: boolean;
      experiments?: import('./experiments.js').Experiments;
    },
  ): Promise<Result>;
  createReplay(runId: string): RuntimeReplay;
  record(runId: string, event: Record<string, unknown>): void;
  saveInitial(runId: string, initial: Record<string, unknown>): void;
}
