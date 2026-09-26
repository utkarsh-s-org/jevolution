// Transport fixtures verify hosting, not model quality or ecological outcomes.
import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import decisionEndpoint from '../../../api/arena/decision.js';
import sessionEndpoint from '../../../api/arena/session.js';
import { DEFAULT_GROUPS } from '../../../core/src/evolution/constants.js';
import { observe } from '../../../core/src/evolution/simulation.js';
import type { Result } from '../../../core/src/evolution/types.js';
import { createWorld } from '../../../core/src/evolution/world.js';
import { authenticated, sessionCookie } from './hostedAuth.js';

const origin = 'https://jevolution.world';
const code = 'hosted-test-only-access-code-00000000';
const request = (path: string, body?: unknown, cookie?: string, from = origin) =>
  new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: from, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('hosted sessions fail closed and issue a scoped, expiring, HTTP-only cookie', async () => {
  const previous = process.env.ARENA_ACCESS_CODE;
  try {
    delete process.env.ARENA_ACCESS_CODE;
    assert.equal(authenticated(request('/api/arena/session')), false);
    process.env.ARENA_ACCESS_CODE = code;
    assert.equal(
      (await sessionEndpoint.fetch(request('/api/arena/session', { code: 'wrong' }))).status,
      401,
    );
    assert.equal(
      (
        await sessionEndpoint.fetch(
          request('/api/arena/session', { code }, undefined, 'https://another.example'),
        )
      ).status,
      403,
    );
    const response = await sessionEndpoint.fetch(request('/api/arena/session', { code }));
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
    assert.ok(!cookie.includes(code));
    assert.match(cookie, /Max-Age=3600/);
    const crossOriginLogout = await sessionEndpoint.fetch(
      new Request(`${origin}/api/arena/session`, {
        method: 'DELETE',
        headers: { origin: 'https://another.example', cookie },
      }),
    );
    assert.equal(crossOriginLogout.status, 403);
    const logout = await sessionEndpoint.fetch(
      new Request(`${origin}/api/arena/session`, {
        method: 'DELETE',
        headers: { origin, cookie },
      }),
    );
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal(
      authenticated(request('/api/arena/session', undefined, logout.headers.get('set-cookie')!)),
      false,
    );
    assert.equal((await sessionEndpoint.fetch(request('/api/arena/session', null))).status, 401);
    assert.ok(authenticated(request('/api/arena/session', undefined, cookie)));
    assert.equal(
      authenticated(request('/api/arena/session', undefined, cookie.replace(/=[^.]+/, '=1'))),
      false,
    );
    assert.equal(
      authenticated(
        request('/api/arena/session', undefined, 'jevolution_session=9999999999.forged'),
      ),
      false,
    );
    process.env.ARENA_ACCESS_CODE = code + '-rotated';
    assert.equal(authenticated(request('/api/arena/session', undefined, cookie)), false);
  } finally {
    if (previous === undefined) delete process.env.ARENA_ACCESS_CODE;
    else process.env.ARENA_ACCESS_CODE = previous;
  }
});

test('hosted API refuses unauthorized requests before provider calls and preserves real adapter output', async () => {
  const originalFetch = globalThis.fetch;
  const previousCode = process.env.ARENA_ACCESS_CODE;
  const previousKey = process.env.TYPESAFE_API_KEY;
  let calls = 0;
  try {
    process.env.ARENA_ACCESS_CODE = code;
    process.env.TYPESAFE_API_KEY = 'transport-fixture-not-a-real-key';
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        answers: { action: { choice: 'rest' }, signal: { choice: 'none' } },
        usage: { input_tokens: 12, output_tokens: 2 },
      });
    };
    const world = createWorld(123);
    const observation = observe(world, world.rabbits[0]);
    const body = {
      group: DEFAULT_GROUPS[0],
      observation,
      options: { relief: true, predatorPrey: false },
    };
    assert.equal((await decisionEndpoint.fetch(request('/api/arena/decision', body))).status, 401);
    assert.equal(calls, 0);
    const cookie = sessionCookie();
    assert.equal(
      (
        await decisionEndpoint.fetch(
          request('/api/arena/decision', body, cookie, 'https://another.example'),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await decisionEndpoint.fetch(
          request('/api/arena/decision', { group: { provider: '__proto__' } }, cookie),
        )
      ).status,
      400,
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await decisionEndpoint.fetch(
          request('/api/arena/decision', { ...body, observation: 'invalid' }, cookie),
        )
      ).status,
      400,
    );
    const response = await decisionEndpoint.fetch(request('/api/arena/decision', body, cookie));
    assert.equal(response.status, 200);
    const result = (await response.json()) as Result;
    assert.equal(result.decision.choice, 'rest');
    assert.equal(result.nativeResponse?.format, 'Structured answers');
    assert.equal(result.inputTokens, 12);
    assert.ok(result.latencyMs >= 0);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(process.env.TYPESAFE_API_KEY));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousCode === undefined) delete process.env.ARENA_ACCESS_CODE;
    else process.env.ARENA_ACCESS_CODE = previousCode;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  }
});
