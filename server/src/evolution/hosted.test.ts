import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import decision from '../../../api/arena/decision.js';
import session from '../../../api/arena/session.js';
import { DEFAULT_GROUPS } from '../../../core/src/evolution/constants.js';
import { defaultExperimentPreview } from '../../../core/src/evolution/experimentPreview.js';
import { BASELINE_EXPERIMENTS } from '../../../core/src/evolution/experiments.js';
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

test('BYOK forwards both mechanism instructions and environmental settings without exposing credentials', async (t) => {
  const world = createWorld(123);
  const experiment = defaultExperimentPreview();
  experiment.values.temperature = 40;
  const observation = { ...observe(world, world.rabbits[0]), experiment: experiment.values };
  const experiments = { ...BASELINE_EXPERIMENTS, demographics: true, communication: false };
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
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
    request({ group: DEFAULT_GROUPS[0], observation, options: { experiments } }, 'visitor-fixture'),
  );
  assert.equal(response.status, 200);
  assert.equal(mock.mock.calls.length, 1);
  assert.ok(!(await response.text()).includes('visitor-fixture'));
});
