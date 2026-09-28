import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'jevolution_session';
const TTL_SECONDS = 60 * 60;
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function secret() {
  return process.env.ARENA_ACCESS_CODE || '';
}
function signature(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}
export function validAccessCode(value: unknown) {
  return typeof value === 'string' && secret().length >= 24 && equal(value, secret());
}
export function authenticated(request: Request) {
  if (secret().length < 24) return false;
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expiration, mac, extra] = token.split('.');
  const seconds = Number(expiration);
  return (
    !extra &&
    !!mac &&
    Number.isSafeInteger(seconds) &&
    seconds > Date.now() / 1000 &&
    seconds <= Date.now() / 1000 + TTL_SECONDS + 60 &&
    equal(signature(expiration), mac)
  );
}
export function sessionCookie() {
  const expiration = String(Math.floor(Date.now() / 1000) + TTL_SECONDS);
  return `${COOKIE}=${expiration}.${signature(expiration)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_SECONDS}`;
}
export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
}
