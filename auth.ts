import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AppEnv, Role, User } from '../types'

const SESSION_COOKIE = 'ia_session'
const SESSION_DAYS = 14
const PBKDF2_ITERATIONS = 100_000

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return toHex(arr.buffer)
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256
  )
  return toHex(bits)
}

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const actual = await hashPassword(password, salt)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomToken(32)
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expires).run()
  await db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(userId).run()
  return token
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_DAYS * 86400
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  clearSessionCookie(c)
}

export async function getUserFromRequest(c: Context<AppEnv>): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE) || c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.is_premium, u.telegram_id, u.active, u.created_at, u.last_login_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
  )
    .bind(token)
    .first<User>()
  return row ?? null
}

/** Attaches user if a valid session exists; never rejects. */
export const attachUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getUserFromRequest(c)
  if (user) c.set('user', user)
  await next()
}

/** Requires an authenticated user with one of the given roles. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user') ?? (await getUserFromRequest(c))
    if (!user) return c.json({ error: 'Authentication required', code: 'unauthenticated' }, 401)
    if (roles.length && !roles.includes(user.role)) {
      return c.json({ error: 'You do not have permission to do that', code: 'forbidden' }, 403)
    }
    c.set('user', user)
    await next()
  }
}

export const isStaff = (u: User) => u.role === 'admin' || u.role === 'creator'
