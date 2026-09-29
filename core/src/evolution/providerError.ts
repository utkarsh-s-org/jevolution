import type { NativeDecisionResponse } from './types.js';

export class ProviderError extends Error {
  code?: 'credits_exhausted';
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

// Classify only explicit provider billing signals. A bare 429 is a rate limit.
export function isCreditFailure(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const error = (
    body as {
      error?: { code?: string; type?: string; message?: string; details?: { error_code?: string } };
    }
  ).error;
  if (!error || typeof error !== 'object') return false;
  const codes = [
    'insufficient_quota',
    'insufficient_credits',
    'credit_balance_too_low',
    'enforced_spend_limit_reached',
  ];
  return (
    [error.code, error.type, error.details?.error_code].some(
      (code) => !!code && codes.includes(code),
    ) ||
    (typeof error.message === 'string' && /credit balance is too low/i.test(error.message))
  );
}
