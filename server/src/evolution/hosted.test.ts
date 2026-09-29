import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import decision from '../../../api/arena/decision.js';
import runs from '../../../api/arena/runs.js';
import session from '../../../api/arena/session.js';
import { DEFAULT_GROUPS } from '../../../core/src/evolution/constants.js';
import { defaultExperimentPreview } from '../../../core/src/evolution/experimentPreview.js';
import { BASELINE_EXPERIMENTS } from '../../../core/src/evolution/experiments.js';
import { observe } from '../../../core/src/evolution/simulation.js';
import { createWorld } from '../../../core/src/evolution/world.js';
import { encryptAccountKey } from './accountKeyVault.js';
import { sessionCookie } from './accountStore.js';
const url = 'https://jevolution.world/api/arena/decision';
const secret = Buffer.alloc(32, 42).toString('base64');
function request(body: unknown, token?: string, origin = 'https://jevolution.world') {
  const request = new Request(url);
  const cookie = token
    ? sessionCookie(request, { access_token: token, refresh_token: 'refresh' })['set-cookie'].split(
        ';',
      )[0]
    : '';
  return new Request(url, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      cookie,
      'x-provider-key': 'ignored-device-key',
    },
    body: JSON.stringify(body),
  });
}
test('account proxy requires a verified session, isolates users and keys, and refuses owner fallback', async () => {
  const originalFetch = globalThis.fetch;
  const saved = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'public-test',
    ACCOUNT_KEY_ENCRYPTION_SECRET: secret,
    TYPESAFE_API_KEY: 'owner-secret-never-use',
  });
  const sent: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const address = String(input);
      const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') || '';
      if (address.endsWith('/auth/v1/user'))
        return ['alice', 'bob'].includes(token)
          ? Response.json({
              id: token,
              email: `${token}@example.test`,
              email_confirmed_at: '2026-01-01',
            })
          : Response.json({}, { status: 401 });
      if (address.includes('/rest/v1/jevolution_provider_keys'))
        return Response.json([
          {
            provider: 'typesafe',
            ciphertext: encryptAccountKey(secret, token, 'typesafe', `personal-${token}`),
          },
        ]);
      if (address.includes('/rest/v1/jevolution_runs'))
        return Response.json([{ id: 'own-run', user_id: token }]);
      sent.push(new Headers(init?.headers).get('authorization')!);
      return Response.json({
        answers: { action: { choice: 'rest' }, signal: { choice: 'none' } },
        usage: { input_tokens: 12, output_tokens: 2 },
      });
    };
    const world = createWorld(123);
    const body = { group: DEFAULT_GROUPS[0], observation: observe(world, world.rabbits[0]) };
    assert.equal((await decision.fetch(request(body))).status, 401);
    assert.equal((await decision.fetch(request(body, 'forged'))).status, 401);
    assert.equal(
      (await decision.fetch(request(body, 'alice', 'https://evil.example'))).status,
      403,
    );
    assert.equal(
      (await decision.fetch(request({ group: { provider: '__proto__' } }, 'alice'))).status,
      400,
    );
    assert.equal(sent.length, 0);
    const results = await Promise.all(
      ['alice', 'bob'].map((token) => decision.fetch(request(body, token))),
    );
    assert.deepEqual(sent.sort(), ['Bearer personal-alice', 'Bearer personal-bob']);
    for (const response of results) {
      assert.equal(response.status, 200);
      assert.ok(!/personal-|owner-secret|ignored-device/.test(await response.text()));
    }
    const headers = { cookie: request({}, 'alice').headers.get('cookie')! };
    const info = await session.fetch(
      new Request('https://jevolution.world/api/arena/session', { headers }),
    );
    assert.ok(!(await info.text()).includes('personal-alice'));
    const list = await runs.fetch(
      new Request('https://jevolution.world/api/arena/runs', { headers }),
    );
    assert.equal(((await list.json()) as { runs: { user_id: string }[] }).runs[0].user_id, 'alice');
    const mismatch = await runs.fetch(
      new Request('https://jevolution.world/api/arena/runs', {
        headers: { ...headers, 'x-account-id': 'bob' },
      }),
    );
    assert.equal(mismatch.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'ACCOUNT_KEY_ENCRYPTION_SECRET',
      'TYPESAFE_API_KEY',
    ]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('account BYOK forwards both mechanism instructions and environmental settings without exposing credentials', async (t) => {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ACCOUNT_KEY_ENCRYPTION_SECRET'] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'public-test',
    ACCOUNT_KEY_ENCRYPTION_SECRET: secret,
  });
  t.after(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  const world = createWorld(123);
  const experiment = defaultExperimentPreview();
  experiment.values.temperature = 40;
  const observation = { ...observe(world, world.rabbits[0]), experiment: experiment.values };
  const experiments = { ...BASELINE_EXPERIMENTS, demographics: true, communication: false };
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const address = String(input);
      if (address.endsWith('/auth/v1/user')) {
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer alice');
        return Response.json({
          id: 'alice',
          email: 'alice@example.test',
          email_confirmed_at: '2026-01-01',
        });
      }
      if (address.includes('/rest/v1/jevolution_provider_keys')) {
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer alice');
        return Response.json([
          { ciphertext: encryptAccountKey(secret, 'alice', 'typesafe', 'visitor-fixture') },
        ]);
      }
      assert.equal(address, 'https://api.typesafe.ai/v1/systemone');
      const body = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer visitor-fixture');
      assert.deepEqual(body.state.experiment, experiment.values);
      assert.match(body.questions.action.instructions, /never happens alone/);
      assert.match(body.questions.action.instructions, /Communication is disabled/);
      assert.match(body.questions.action.instructions, /active experiment settings/);
      assert.deepEqual(Object.keys(body.questions.signal.criteria), ['none']);
      assert.ok(!String(init?.body).includes('visitor-fixture'));
      return Response.json({ answers: { action: { choice: 'rest' }, signal: { choice: 'none' } } });
    },
  );
  const response = await decision.fetch(
    request({ group: DEFAULT_GROUPS[0], observation, options: { experiments } }, 'alice'),
  );
  assert.equal(response.status, 200);
  assert.equal(mock.mock.calls.length, 3);
  assert.ok(!(await response.text()).includes('visitor-fixture'));
});
