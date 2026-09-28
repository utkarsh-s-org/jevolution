import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import decision from '../../../api/arena/decision.js';
import session from '../../../api/arena/session.js';
import { DEFAULT_GROUPS } from '../../../core/src/evolution/constants.js';
import { observe } from '../../../core/src/evolution/simulation.js';
import { createWorld } from '../../../core/src/evolution/world.js';
const url = 'https://jevolution.world/api/arena/decision';
function request(body: unknown, key?: string, origin = 'https://jevolution.world') {
  return new Request(url, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(key ? { 'x-provider-key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}
test('BYOK rejects missing keys even with project credentials, isolates simultaneous visitor keys, and never returns secrets', async () => {
  const originalFetch = globalThis.fetch;
  const prior = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'owner-secret-never-use';
  const sent: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      sent.push(new Headers(init?.headers).get('authorization')!);
      return Response.json({
        answers: { action: { choice: 'rest' }, signal: { choice: 'none' } },
        usage: { input_tokens: 12, output_tokens: 2 },
      });
    };
    const world = createWorld(123);
    const body = { group: DEFAULT_GROUPS[0], observation: observe(world, world.rabbits[0]) };
    assert.equal((await decision.fetch(request(body))).status, 401);
    assert.equal(
      (await decision.fetch(request(body, 'visitor-a', 'https://evil.example'))).status,
      403,
    );
    assert.equal(
      (await decision.fetch(request({ group: { provider: '__proto__' } }, 'visitor-a'))).status,
      400,
    );
    assert.equal(sent.length, 0);
    const results = await Promise.all(
      ['visitor-a', 'visitor-b'].map((k) => decision.fetch(request(body, k))),
    );
    assert.deepEqual(sent.sort(), ['Bearer visitor-a', 'Bearer visitor-b']);
    for (const response of results) {
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(!/visitor-|owner-secret/.test(text));
      assert.equal(JSON.parse(text).decision.choice, 'rest');
    }
    const info = await session.fetch(new Request('https://jevolution.world/api/arena/session'));
    assert.ok(!(await info.text()).includes('owner-secret'));
    globalThis.fetch = async () =>
      Response.json({ error: { message: 'visitor-a' } }, { status: 401 });
    const failed = await decision.fetch(request(body, 'visitor-a'));
    assert.ok(!(await failed.text()).includes('visitor-a'));
  } finally {
    globalThis.fetch = originalFetch;
    if (prior === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = prior;
  }
});
