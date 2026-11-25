import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';

const COOKIE_NAME = 'badminton_admin';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionToken(secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const exp = nowSec + SESSION_TTL_SECONDS;
  const payload = `admin:${exp}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}:${sig}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(':');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < nowSec) return false;
  const expectedSig = await hmacSha256Hex(secret, `${parts[0]}:${parts[1]}`);
  return timingSafeEqual(parts[2], expectedSig);
}

export function verifyPassword(input: string, configured: string): boolean {
  if (!configured) return false;
  return timingSafeEqual(input, configured);
}

export async function setAdminSessionCookie(c: Context<{ Bindings: Env }>): Promise<void> {
  const token = await createSessionToken(c.env.SESSION_SECRET || c.env.ADMIN_PASSWORD);
  const isSecure = c.req.url.startsWith('https://');
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearAdminSessionCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export async function isAdminAuthenticated(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const token = getCookie(c, COOKIE_NAME);
  return verifySessionToken(token, c.env.SESSION_SECRET || c.env.ADMIN_PASSWORD);
}

export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const ok = await isAdminAuthenticated(c);
  if (!ok) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}
