import {
  authenticated,
  clearSessionCookie,
  json,
  sameOrigin,
  sessionCookie,
  validAccessCode,
} from '../../server/src/evolution/hostedAuth.js';
import { defaultGroups, providerReadiness } from '../../server/src/evolution/models.js';

export default {
  async fetch(request: Request) {
    if (request.method === 'GET')
      return json({
        authenticated: authenticated(request),
        ready: providerReadiness(),
        groups: defaultGroups(),
      });
    if (!sameOrigin(request)) return json({ error: 'Cross-origin access is disabled' }, 403);
    if (request.method === 'DELETE')
      return json({ authenticated: false }, 200, { 'set-cookie': clearSessionCookie() });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return json({ error: 'JSON required' }, 415);
    const text = await request.text();
    if (text.length > 512) return json({ error: 'Request too large' }, 413);
    try {
      const body = JSON.parse(text);
      if (!validAccessCode(body?.code)) return json({ error: 'Incorrect password.' }, 401);
      return json({ authenticated: true }, 200, { 'set-cookie': sessionCookie() });
    } catch {
      return json({ error: 'Invalid request' }, 400);
    }
  },
};
