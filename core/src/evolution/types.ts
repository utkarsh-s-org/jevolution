export type Lineage = string;
/** 'arena' compares configurable groups; 'predatorPrey' is the Lotka-Volterra preset (Jev rabbits vs Jev wolves). */
export type Scenario = 'arena' | 'predatorPrey';
export type Species = 'rabbit' | 'wolf';
export type WolfLifeCycle = 'dynamic' | 'fixed';
export type Controller = 'model' | 'deterministic';
export type Provider = 'typesafe' | 'anthropic' | 'openai' | 'google';
export interface ModelGroup {
  // Omitted fields support older rabbit-only configurations. Validated rosters normalize them.
  species?: Species;
  controller?: Controller;
  population?: number;
  wolfLifeCycle?: WolfLifeCycle;
  id: string;
  label: string;
  provider: Provider;
  model: string;
  color: number;
  delayMs: number;
}
export interface FollowBehavior {
  offered: number;
  followed: number;
  other: number;
}

export type Terrain = 'grass' | 'forest' | 'water' | 'mountain' | 'shelter';
export type Action =
  | 'rest'
  | 'forage'
  | 'drink'
  | 'explore'
  | 'flee'
  | 'hide'
  | 'mate'
  | 'follow'
  | 'collect'
  | 'share'
  | 'deposit'
  | 'withdraw'
  | 'eatCargo';
export type Signal = 'none' | 'danger' | 'food' | 'follow' | 'help';
export type Genes = {
  speed: number;
  vigilance: number;
  thrift: number;
  fertility: number;
  sociability: number;
};
export interface Point {
  x: number;
  y: number;
}
export interface Tile extends Point {
  water?: number;
  edited?: boolean;
  kind: Terrain;
  food: number;
  foodCapacity: number;
  elevation: number;
  decor: number;
}
export interface Memory {
  kind: 'food' | 'water' | 'danger';
  position: Point;
  observedAt: number;
  food?: number;
  wolfId?: number;
}
export interface LifeHistory {
  sex: 'female' | 'male';
  deathAge: number;
  dispersed: boolean;
  pregnancy?: { due: number; father: number; generation: number; fatherGenes?: Genes };
}
export interface Rabbit extends Point {
  committedUntil?: number;
  knownTiles?: number[];
  shelterKey?: string;
  shelterArrival?: number;
  life?: LifeHistory;
  id: number;
  lineage: Lineage;
  genes: Genes;
  energy: number;
  water: number;
  age: number;
  generation: number;
  parents: number[];
  action: Action;
  path: Point[];
  target?: Point;
  mateId?: number;
  followId?: number;
  cooldown: number;
  nextDecision: number;
  pending: boolean;
  face: number;
  lastLatency: number | null;
  lastSignal: Signal;
  signalUntil: number;
  born: number;
  memory: Memory[];
  nextFollow: number;
  /** World time when the current foraging bout ends; unset until the rabbit arrives. */
  forageUntil?: number;
  behavior: FollowBehavior;
  cargo: number;
  recipientId?: number;
  helpRequestedAt?: number;
  nextHelpSignal: number;
}
export type WolfAction = 'rest' | 'hunt' | 'explore' | 'mate' | 'drink' | 'scavenge' | 'follow';
export interface Wolf extends Point {
  committedUntil?: number;
  knownTiles?: number[];
  followId?: number;
  water?: number;
  nextAttack?: number;
  carcassId?: number;
  life?: LifeHistory;
  energy?: number;
  age?: number;
  generation?: number;
  /** Legacy replay field; new offspring record both parents. */
  parentId?: number;
  parents?: number[];
  mateId?: number;
  born?: number;
  reproductionCooldown?: number;
  lineage?: Lineage;
  action?: WolfAction;
  nextDecision?: number;
  pending?: boolean;
  lastLatency?: number | null;
  id: number;
  path: Point[];
  cooldown: number;
  nextHunt: number;
  face: number;
  target?: number;
}
export interface LocalSignal extends Point {
  messageId?: string;
  sender: number;
  lineage: Lineage;
  kind: Signal;
  delivered: number;
  expires: number;
  range: number;
}
export interface FoodCache extends Point {
  id: number;
  food: number;
}
export interface ReliefStats {
  deliveries: number;
  foodShared: number;
  urgentFed: number;
  deposited: number;
  withdrawn: number;
  responses: number[];
}
export interface ReliefEvent {
  id: number;
  time: number;
  kind: 'collect' | 'share' | 'deposit' | 'withdraw' | 'eatCargo' | 'help';
  actor: number;
  lineage: Lineage;
  recipient?: number;
  cacheId?: number;
  amount: number;
  from: Point;
  to: Point;
  energyBefore?: number;
  energyAfter?: number;
  responseSeconds?: number;
}
export interface DroughtReport {
  startedAt: number;
  endsAt: number;
  cohort: Record<Lineage, number[]>;
  survivors?: Record<Lineage, number>;
  deliveries?: Record<Lineage, number>;
  baseline: Record<Lineage, ReliefStats>;
}
export interface Candidate {
  id: string;
  action: Action;
  description: string;
  target?: Point;
  mateId?: number;
  followId?: number;
  recipientId?: number;
  cacheId?: number;
}
export interface Observation {
  experiment?: import('./experimentPreview.js').ExperimentPreview['values'];
  caches: FoodCache[];
  rabbit: {
    sex?: 'female' | 'male';
    pregnancyDue?: number;
    id: number;
    age: number;
    generation: number;
    energy: number;
    cargo: number;
    water: number;
    genes: Genes;
    position: Point;
  };
  environment: { time: number; drought: boolean; tile: Terrain; grass: number };
  wolves: Point[];
  neighbors: {
    id: number;
    ally: boolean;
    position: Point;
    energy: number;
    cargo: number;
    needsFood: boolean;
    action: Action;
    moving: boolean;
    heading: Point | null;
  }[];
  signals: { id?: string; sender: number; kind: Signal; position: Point; age: number }[];
  memory: (Omit<Memory, 'observedAt' | 'wolfId'> & { age: number })[];
  choices: Candidate[];
}
export interface WolfCandidate {
  followId?: number;
  carcassId?: number;
  id: string;
  action: WolfAction;
  description: string;
  target?: Point;
  preyId?: number;
  mateId?: number;
}
export interface WolfObservation {
  experiment?: import('./experimentPreview.js').ExperimentPreview['values'];
  signals?: { id?: string; sender: number; kind: Signal; position: Point; age: number }[];
  wolf: {
    sex?: 'female' | 'male';
    pregnancyDue?: number;
    water?: number;
    id: number;
    position: Point;
    action: WolfAction;
    cooldown: number;
    hungry: boolean;
    lifeCycle: WolfLifeCycle;
    energy: number | null;
    age: number | null;
    generation: number;
    reproductionCooldown: number | null;
    mateId?: number;
  };
  environment: { time: number; tile: Terrain };
  prey: { id: number; position: Point; moving: boolean }[];
  neighbors: {
    id: number;
    position: Point;
    action: WolfAction;
    ally: boolean;
    mateId?: number;
    readyToMate?: boolean;
  }[];
  choices: WolfCandidate[];
}
export type ModelObservation = Observation | WolfObservation;
export interface Decision {
  choice: string;
  signal: Signal;
}
export interface NativeDecisionResponse {
  format: 'Structured answers' | 'Tool call';
  /** Provider decision block, before normalization; excludes transport headers and envelope. */
  json: string;
  truncated: boolean;
}
export interface Result {
  nativeResponse?: NativeDecisionResponse;
  decision: Decision;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  requestId: string | null;
}
export interface DecisionTrace {
  id: string;
  animalId: number;
  species: 'rabbit' | 'wolf';
  lineage: string;
  label: string;
  provider: Provider;
  model: string;
  startedAt: number;
  simulationTime: number;
  deadlineMs: number;
  timing: RunConfig['timing'];
  delayMs: number;
  state: 'requesting' | 'returned' | 'applied' | 'late' | 'invalid' | 'cancelled' | 'error';
  decision?: Decision;
  nativeResponse?: NativeDecisionResponse;
  action?: string;
  latencyMs?: number;
  effectiveMs?: number;
  message?: string;
}
export interface DecisionFeed {
  runId: string;
  animalId: number;
  traces: DecisionTrace[];
}
export interface LineageStats {
  kills: number;
  relief: ReliefStats;
  behavior: FollowBehavior;
  births: number;
  deaths: number;
  predation: number;
  starvation: number;
  dehydration: number;
  oldAge: number;
  requested: number;
  applied: number;
  late: number;
  invalid: number;
  errors: number;
  cancelled: number;
  inputTokens: number;
  outputTokens: number;
  latencies: number[];
  queueMs: number[];
  queueWallMs?: number[];
  food: number;
  signals: number;
}
export interface HistoryPoint {
  time: number;
  populations: Record<Lineage, number>;
  generation: number;
}
export interface WorldEvent {
  id: number;
  time: number;
  kind: 'birth' | 'death' | 'signal' | 'system';
  text: string;
  lineage?: Lineage;
}
export interface World {
  nextPerception?: number;
  carcasses?: (Point & { id: number; energy: number; createdAt: number })[];
  experiments?: import('./experiments.js').Experiments;
  mechanisms?: Record<string, number>;
  scenario?: Scenario;
  mapRevision?: number;
  groups: ModelGroup[];
  seed: number;
  rng: number;
  time: number;
  tiles: Tile[];
  rabbits: Rabbit[];
  wolves: Wolf[];
  signals: LocalSignal[];
  stats: Record<Lineage, LineageStats>;
  events: WorldEvent[];
  history: HistoryPoint[];
  nextId: number;
  eventId: number;
  experiment?: import('./experimentPreview.js').ExperimentPreview;
  nextDrought?: number;
  droughtTiles?: number[];
  droughtUntil: number;
  lastSample: number;
  caches: FoodCache[];
  reliefEvents: ReliefEvent[];
  nextReliefId: number;
  droughtReport?: DroughtReport;
  /** Predator–prey migrants that have joined (an open population), shown in the record. */
  migrants?: { wolves: number; rabbits: number; lastAt: number };
}
export interface RunConfig {
  experiments?: import('./experiments.js').Experiments;
  /** Unapplied experiment design metadata, not physics or model input. */
  experimentPreview?: import('./experimentPreview.js').ExperimentPreview;
  scenario?: Scenario;
  /** World seconds per real second (1–4). Faster cycles, same calls per real second. */
  timeScale?: number;
  deadlineMs: number;
  decisionIntervalMs: number;
  maxInFlight: number;
  timing: 'realtime' | 'equalized';
  equalizedMs: number;
  maxRequests: number;
  maxSeconds: number;
}
export interface PublicStatus {
  clock?: {
    mode: 'research' | 'realtime';
    round: number;
    roundSeconds: number;
    phase: string;
    queued: number;
  };
  readOnly?: boolean;
  running: boolean;
  reason: string;
  ready: Record<Lineage, boolean>;
  models: Record<Lineage, string>;
  inFlight: Record<Lineage, number>;
  backlog: Record<Lineage, number>;
  config: RunConfig;
  runId: string;
  connections: number;
  estimatedCost: number | null;
  providerReady: Record<Provider, boolean>;
  replay: { frames: number; intervalMs: number; error?: string };
}
export interface Snapshot {
  decisions?: Record<string, DecisionTrace[]>;
  world: World;
  status: PublicStatus;
}
