import { DEFAULT_GROUPS } from '../../core/src/evolution/constants.js';
import { json } from '../../server/src/evolution/hostedAuth.js';
export default {
  async fetch(request: Request) {
    if (request.method !== 'GET') return json({ error: 'Use device-saved API keys.' }, 405);
    return json({
      groups: DEFAULT_GROUPS,
      ready: { typesafe: false, anthropic: false, openai: false, google: false },
      byok: true,
    });
  },
};
