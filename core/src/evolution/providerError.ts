import type { NativeDecisionResponse } from './types.js';

export class ProviderError extends Error {
  nativeResponse?: NativeDecisionResponse;
  latencyMs?: number;
  status: number;
  retryAfterMs: number;
  constructor(message: string, status = 0, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
