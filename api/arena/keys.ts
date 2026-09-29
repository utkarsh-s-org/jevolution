import { PROVIDER_KEYS } from '../../core/src/evolution/constants.js';
import { encryptAccountKey } from '../../server/src/evolution/accountKeyVault.js';
import {
  AccountError,
  accountFailure,
  readJson,
  requireAccount,
  storeJson,
} from '../../server/src/evolution/accountStore.js';
import { json } from '../../server/src/evolution/hostedAuth.js';
export default {
  async fetch(request: Request) {
    try {
      const user = await requireAccount(request);
      if (request.method === 'GET') {
        const keys = await storeJson('jevolution_provider_keys?select=provider,updated_at', user);
        return json({ keys });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const { provider, key, remove } = await readJson(request);
      if (typeof provider !== 'string' || !Object.hasOwn(PROVIDER_KEYS, provider))
        throw new AccountError('Invalid provider.', 400);
      if (remove)
        await storeJson(
          `jevolution_provider_keys?provider=eq.${provider}`,
          user,
          'DELETE',
          undefined,
          { Prefer: 'return=minimal' },
        );
      else {
        const secret = process.env.ACCOUNT_KEY_ENCRYPTION_SECRET;
        if (!secret) throw new AccountError('Account key encryption is not configured.', 503);
        if (
          typeof key !== 'string' ||
          !key.trim() ||
          key.length > 4096 ||
          /[^\x21-\x7e]/.test(key.trim())
        )
          throw new AccountError('Enter a valid API key.', 400);
        await storeJson(
          'jevolution_provider_keys?on_conflict=user_id,provider',
          user,
          'POST',
          {
            user_id: user.id,
            provider,
            ciphertext: encryptAccountKey(secret, user.id, provider, key.trim()),
            updated_at: new Date().toISOString(),
          },
          { Prefer: 'resolution=merge-duplicates,return=minimal' },
        );
      }
      return json({ saved: true });
    } catch (error) {
      return accountFailure(error);
    }
  },
};
