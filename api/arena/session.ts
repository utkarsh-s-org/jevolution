import { DEFAULT_GROUPS } from '../../core/src/evolution/constants.js';
import {
  accountFailure,
  requireAccount,
  storeJson,
} from '../../server/src/evolution/accountStore.js';
import { json } from '../../server/src/evolution/hostedAuth.js';
export default {
  async fetch(request: Request) {
    try {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const user = await requireAccount(request);
      const keys = await storeJson<{ provider: string }[]>(
        'jevolution_provider_keys?select=provider',
        user,
      );
      return json({
        user: { id: user.id, email: user.email },
        groups: DEFAULT_GROUPS,
        ready: Object.fromEntries(
          ['typesafe', 'anthropic', 'openai', 'google'].map((provider) => [
            provider,
            (keys || []).some((key: { provider: string }) => key.provider === provider),
          ]),
        ),
        byok: true,
      });
    } catch (error) {
      return accountFailure(error);
    }
  },
};
