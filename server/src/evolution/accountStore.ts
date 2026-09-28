import { json, sameOrigin } from './hostedAuth.js';

export class AccountError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}
export interface AccountSession {
  access_token: string;
  refresh_token?: string;
}
export interface Account {
  id: string;
  email: string;
  token: string;
}
const cookie = 'jevolution_session';
export function accountConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}
export function supabaseConfig() {
  if (!accountConfigured()) throw new AccountError('Account service is not configured.', 503);
  const url = process.env.SUPABASE_URL!;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
    throw new AccountError('Invalid account service configuration.', 503);
  return { url, key: process.env.SUPABASE_ANON_KEY! };
}
export async function supabase(path: string, token?: string, options: RequestInit = {}) {
  const { url, key } = supabaseConfig();
  const headers = new Headers(options.headers);
  headers.set('apikey', key);
  if (token) headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(20000),
    });
  } catch {
    throw new AccountError('Account storage could not be reached. Please retry.', 503);
  }
  return response;
}
export function readSession(request: Request): AccountSession | null {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${cookie}=`))
    ?.slice(cookie.length + 1);
  if (!value || value.length > 7000) return null;
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString());
    return typeof data.access_token === 'string' && typeof data.refresh_token === 'string'
      ? data
      : null;
  } catch {
    return null;
  }
}
export function sessionCookie(request: Request, session: AccountSession | null) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const value = session ? Buffer.from(JSON.stringify(session)).toString('base64url') : '';
  return {
    'set-cookie': `${cookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session ? 604800 : 0}${secure}`,
  };
}
export async function userForToken(token: string): Promise<Account | null> {
  const response = await supabase('/auth/v1/user', token);
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok) throw new AccountError('Account service temporarily unavailable.', 503);
  const data = (await response.json()) as {
    id?: string;
    email?: string;
    email_confirmed_at?: string;
  };
  if (typeof data.id !== 'string' || !data.email_confirmed_at) return null;
  return { id: data.id, email: data.email || '', token };
}
export async function requireAccount(request: Request): Promise<Account> {
  if (!sameOrigin(request)) throw new AccountError('Cross-origin access is disabled.', 403);
  const session = readSession(request);
  if (!session) throw new AccountError('Log in to continue.', 401);
  const user = await userForToken(session.access_token);
  if (!user) throw new AccountError('Your session expired. Log in again.', 401);
  const expected = request.headers.get('x-account-id');
  if (expected && expected !== user.id)
    throw new AccountError('Account changed. Reload before continuing.', 401);
  return user;
}
export async function readJson(request: Request, max = 16000) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AccountError('JSON required.', 415);
  const text = await request.text();
  if (text.length > max) throw new AccountError('Request too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AccountError('Invalid JSON.', 400);
  }
}
export function accountFailure(error: unknown) {
  return json(
    {
      error:
        error instanceof AccountError ? error.message : 'Account request failed. Please retry.',
    },
    error instanceof AccountError ? error.status : 500,
  );
}
export async function storeJson<T = unknown>(
  path: string,
  account: Account,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
) {
  const response = await supabase(`/rest/v1/${path}`, account.token, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new AccountError(
      'Account storage request failed. Please retry.',
      response.status === 401 ? 401 : 503,
    );
  return response.status === 204 || response.headers.get('content-length') === '0'
    ? null
    : (response.json() as Promise<T>);
}
