import {
  accountConfigured,
  AccountError,
  accountFailure,
  readJson,
  readSession,
  sessionCookie,
  supabase,
  userForToken,
} from '../../server/src/evolution/accountStore.js';
import { json, sameOrigin } from '../../server/src/evolution/hostedAuth.js';

function confirmationRedirect(request: Request) {
  const url = new URL(request.url);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  return new URL(local ? '/arena.html' : '/', url.origin).href;
}

export default {
  async fetch(request: Request) {
    try {
      if (!sameOrigin(request)) return json({ error: 'Cross-origin access is disabled' }, 403);
      if (!accountConfigured())
        return request.method === 'GET'
          ? json({ configured: false, user: null })
          : json({ error: 'Account service is not connected yet.' }, 503);
      if (request.method === 'GET') {
        const session = readSession(request);
        if (!session) return json({ configured: true, user: null });
        let user = await userForToken(session.access_token);
        if (user) return json({ configured: true, user: { id: user.id, email: user.email } });
        const response = await supabase('/auth/v1/token?grant_type=refresh_token', undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        if (!response.ok)
          return json({ configured: true, user: null }, 200, sessionCookie(request, null));
        const data = (await response.json()) as { access_token: string; refresh_token: string };
        user = await userForToken(data.access_token);
        if (!user) return json({ configured: true, user: null }, 200, sessionCookie(request, null));
        return json(
          { configured: true, user: { id: user.id, email: user.email } },
          200,
          sessionCookie(request, {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          }),
        );
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const body = await readJson(request);
      if (body.action === 'logout') {
        const session = readSession(request);
        if (session)
          await supabase('/auth/v1/logout?scope=local', session.access_token, { method: 'POST' });
        return json({ configured: true, user: null }, 200, sessionCookie(request, null));
      }
      if (body.action === 'confirm') {
        if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string')
          throw new AccountError('Invalid confirmation.', 400);
        const user = await userForToken(body.access_token);
        if (!user) throw new AccountError('Confirmation expired. Please log in again.', 401);
        return json(
          { configured: true, user: { id: user.id, email: user.email } },
          200,
          sessionCookie(request, {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
          }),
        );
      }
      if (body.action === 'resend') {
        if (typeof body.email !== 'string' || body.email.length > 254 || !body.email.includes('@'))
          throw new AccountError('Enter your account email first.', 400);
        const response = await supabase(
          `/auth/v1/resend?redirect_to=${encodeURIComponent(confirmationRedirect(request))}`,
          undefined,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'signup', email: body.email.trim() }),
          },
        );
        if (!response.ok)
          throw new AccountError(
            response.status === 429
              ? 'Please wait a minute before requesting another email.'
              : 'Could not send confirmation. Please try again later.',
            response.status === 429 ? 429 : 503,
          );
        return json({ message: 'If this account needs confirmation, a new link is on its way.' });
      }
      if (
        !['login', 'signup'].includes(body.action) ||
        typeof body.email !== 'string' ||
        body.email.length > 254 ||
        !body.email.includes('@') ||
        typeof body.password !== 'string' ||
        body.password.length > 256 ||
        body.password.length < (body.action === 'signup' ? 12 : 1)
      )
        throw new AccountError(
          'Enter a valid email and password (12 characters minimum for sign-up).',
          400,
        );
      const response = await supabase(
        body.action === 'signup'
          ? `/auth/v1/signup?redirect_to=${encodeURIComponent(confirmationRedirect(request))}`
          : '/auth/v1/token?grant_type=password',
        undefined,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: body.email.trim(), password: body.password }),
        },
      );
      if (!response.ok)
        throw new AccountError(
          response.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : body.action === 'login'
              ? 'Unable to log in. Check your email, password, and email confirmation.'
              : 'Unable to create account. Try logging in, or try again later.',
          response.status === 429 ? 429 : 400,
        );
      const data = (await response.json()) as { access_token: string; refresh_token: string };
      if (!data.access_token)
        return json({
          configured: true,
          user: null,
          message: 'Check your inbox. Confirm your email to open your habitat.',
        });
      const user = await userForToken(data.access_token);
      if (!user) throw new AccountError('Confirm your email before logging in.', 403);
      return json(
        { configured: true, user: { id: user.id, email: user.email } },
        200,
        sessionCookie(request, {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        }),
      );
    } catch (error) {
      return accountFailure(error);
    }
  },
};
