import type {
  EscapeWarning,
  FoodTaskState,
  ModelGroup,
  ModelObservation,
  NativeDecisionResponse,
  Result,
} from '../../../core/src/evolution/types.js';

export const CONTRACT = 'jevolution.food-delivery.v1';
export const ESCAPE_CONTRACT = 'jevolution.cover-warning.v1';
interface RequestBase {
  requestId: string;
  runId: string;
  requester: number;
  helper: number;
  expiresAt: number;
}
export interface FoodRequest extends RequestBase {
  contract: typeof CONTRACT;
}
export interface EscapeRequest extends RequestBase {
  contract: typeof ESCAPE_CONTRACT;
  escape: EscapeWarning;
}
export type CooperationRequest = FoodRequest | EscapeRequest;
export type ChooseOptions = { relief: boolean; predatorPrey: boolean; cooperation: boolean };
export type WorkerCommand =
  | {
      type: 'choose';
      id: string;
      group: ModelGroup;
      observation: ModelObservation;
      options: ChooseOptions;
    }
  | { type: 'abort'; id: string }
  | { type: 'send'; id: string; url: string; request: CooperationRequest }
  | { type: 'update'; taskId: string; state: FoodTaskState; reason: string; receipt?: object }
  | { type: 'cancel'; id: string; url: string; taskId: string }
  | { type: 'inspect'; id: string; url: string; taskId: string };
export type WorkerEvent =
  | { type: 'ready'; url: string }
  | {
      type: 'result';
      id: string;
      result?: Result;
      value?: unknown;
      error?: {
        message: string;
        status: number;
        retryAfterMs: number;
        nativeResponse?: NativeDecisionResponse;
        latencyMs?: number;
      };
    }
  | { type: 'incoming'; request: CooperationRequest; taskId: string }
  | { type: 'canceled'; taskId: string }
  | { type: 'wire'; requestId: string; payload: unknown }
  | { type: 'transport-error'; requestId: string; message: string };
