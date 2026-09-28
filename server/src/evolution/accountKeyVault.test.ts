import * as assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import account from '../../../api/arena/account.js';
import { decryptAccountKey, encryptAccountKey } from './accountKeyVault.js';

test('account keys are encrypted with unique nonces and bound to owner and provider', () => {
  const secret = randomBytes(32).toString('base64');
  const encrypted = encryptAccountKey(secret, 'alice', 'anthropic', 'test-provider-key');
  assert.equal(decryptAccountKey(secret, 'alice', 'anthropic', encrypted), 'test-provider-key');
  assert.notEqual(encrypted, encryptAccountKey(secret, 'alice', 'anthropic', 'test-provider-key'));
  assert.ok(!encrypted.includes('test-provider-key'));
  assert.throws(() => decryptAccountKey(secret, 'bob', 'anthropic', encrypted));
  assert.throws(() => decryptAccountKey(secret, 'alice', 'typesafe', encrypted));
  assert.throws(() =>
    decryptAccountKey(randomBytes(32).toString('base64'), 'alice', 'anthropic', encrypted),
  );
  const parts = encrypted.split('.');
  const ciphertext = Buffer.from(parts[3], 'base64');
  ciphertext[0] ^= 1;
  parts[3] = ciphertext.toString('base64');
  assert.throws(() => decryptAccountKey(secret, 'alice', 'anthropic', parts.join('.')));
});

test('key vault rejects invalid secrets and credentials', () => {
  assert.throws(() => encryptAccountKey('bad', 'alice', 'typesafe', 'test-key'));
  const secret = randomBytes(32).toString('base64');
  for (const key of ['', 'with spaces', 'x'.repeat(4097)])
    assert.throws(() => encryptAccountKey(secret, 'alice', 'typesafe', key));
});

test('unconfigured account service cannot create sessions or accept credentials', async () => {
  const prior = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  try {
    const get = await account.fetch(new Request('https://jevolution.world/api/arena/account'));
    assert.deepEqual(await get.json(), { configured: false, user: null });
    const post = await account.fetch(
      new Request('https://jevolution.world/api/arena/account', { method: 'POST' }),
    );
    assert.equal(post.status, 503);
    assert.equal(post.headers.get('set-cookie'), null);
    const cross = await account.fetch(
      new Request('https://jevolution.world/api/arena/account', {
        method: 'POST',
        headers: { origin: 'https://other.example' },
      }),
    );
    assert.equal(cross.status, 403);
  } finally {
    if (prior !== undefined) process.env.SUPABASE_URL = prior;
  }
});

test('signup and resend return to the originating app and never accept a caller redirect', async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousKey;
  });
  const calls: { url: URL; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url: new URL(url), body: JSON.parse(options.body as string) });
    return Response.json({ id: 'new-unconfirmed-user' });
  });
  for (const [origin, redirect] of [
    ['http://127.0.0.1:5174', 'http://127.0.0.1:5174/arena.html'],
    ['https://jevolution.world', 'https://jevolution.world/'],
  ]) {
    for (const action of ['signup', 'resend']) {
      const response = await account.fetch(
        new Request(`${origin}/api/arena/account`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            email: 'tester@example.com',
            password: 'test-password-only',
            redirect_to: 'https://attacker.example',
          }),
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(calls.at(-1)?.url.searchParams.get('redirect_to'), redirect);
      assert.equal(calls.at(-1)?.url.pathname, `/auth/v1/${action}`);
      assert.ok(!JSON.stringify(calls.at(-1)?.body).includes('attacker.example'));
      if (action === 'signup') {
        const data = (await response.json()) as { user: unknown };
        assert.equal(data.user, null);
      }
    }
  }
});
