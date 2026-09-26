import type {
  Candidate,
  CoordinationMode,
  CoordinationSnapshot,
  ModelGroup,
  ModelObservation,
  Observation,
  Provider,
  Rabbit,
  Result,
  Snapshot,
  World,
} from './types.js';

// Optional local-server capabilities. The browser runtime never imports Node adapters.
export interface RuntimeCoordination {
  error?: string;
  snapshot(): CoordinationSnapshot;
  augment(rabbit: Rabbit, observation: Observation): void;
  validate(rabbit: Rabbit, choice: Candidate): boolean;
  applied(rabbit: Rabbit, choice: Candidate, decisionId: string): string | undefined;
  sync(): void;
  cancelAll(reason: string): void;
  inspect(id: string): Promise<unknown>;
  dispose(): void;
}

export interface RuntimeBudget {
  readonly exposure: number;
  reserve(id: string, group: ModelGroup, observation: ModelObservation, cap?: number): boolean;
  settle(id: string, group: ModelGroup, result: Result): void;
  validate(groups: ModelGroup[]): void;
  estimateCost(world: World): number | null;
}

export interface RuntimeReplay {
  frames: number;
  error?: string;
  capture(snapshot: Snapshot): void;
  flush(): void;
  get(index: number): Snapshot | Promise<Snapshot>;
}

export interface RuntimeServices {
  createBudget?(): RuntimeBudget;
  createCoordination?(context: {
    mode: Exclude<CoordinationMode, 'off'>;
    runId: string;
    world(): World;
    record(event: Record<string, unknown>): void;
    onFailure(message: string): void;
  }): Promise<RuntimeCoordination>;
  id(): string;
  defaultGroups(): ModelGroup[];
  modelDefaults: { jev: string; claude: string };
  jevModel?(): string | undefined;
  providerReadiness(): Record<Provider, boolean>;
  choose(
    group: ModelGroup,
    observation: ModelObservation,
    signal: AbortSignal,
    options: { relief: boolean; predatorPrey: boolean; cooperation: boolean },
  ): Promise<Result>;
  createReplay(runId: string): RuntimeReplay;
  record(runId: string, event: Record<string, unknown>): void;
  saveInitial(runId: string, initial: Record<string, unknown>): void;
}
