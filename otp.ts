import { randomToken } from './auth'
import type { AppEnv } from '../types'

export type Purpose = 'login' | 'reset'
const TTL_MS = 5 * 60_000, WINDOW_MS = 15 * 60_000, COOLDOWN_MS = 30_000
const MAX_TRIES = 5, MAX_PER_USER = 3, MAX_PER_IP = 10

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Last 10 digits, or '' when the value is not a phone number. */
export const phoneOf = (v: string) => { const d = v.replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }

export async function findUserByIdentifier(db: D1Database, idv: string) {
  const t = idv.trim().toLowerCase()
  if (t.includes('@')) return db.prepare('SELECT id, email, phone, active FROM users WHERE lower(email) = ?').bind(t).first<{ id: number; email: string; phone: string | null; active: number }>()
  const p = phoneOf(t)
  if (!p) return null
  return db.prepare('SELECT id, email, phone, active FROM users WHERE phone = ?').bind(p).first<{ id: number; email: string; phone: string | null; active: number }>()
}

export type IssueResult = { ok: true; code: string } | { ok: false; reason: 'cooldown' | 'rate_user' | 'rate_ip' }

/** Creates a 6-digit code (stored only as a salted hash), replacing any unused older code. Rate limited per user and per IP. */
export async function issueOtp(db: D1Database, userId: number, purpose: Purpose, ipHash: string): Promise<IssueResult> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const u = await db.prepare('SELECT COUNT(*) n, MAX(created_at) last FROM otp_codes WHERE user_id = ? AND created_at >= ?').bind(userId, since).first<{ n: number; last: string | null }>()
  if (u?.last && Date.now() - Date.parse(u.last) < COOLDOWN_MS) return { ok: false, reason: 'cooldown' }
  if ((u?.n ?? 0) >= MAX_PER_USER) return { ok: false, reason: 'rate_user' }
  if (ipHash) {
    const i = await db.prepare('SELECT COUNT(*) n FROM otp_codes WHERE ip_hash = ? AND created_at >= ?').bind(ipHash, since).first<{ n: number }>()
    if ((i?.n ?? 0) >= MAX_PER_IP) return { ok: false, reason: 'rate_ip' }
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  const salt = randomToken(8), now = new Date().toISOString()
  await db.batch([
    db.prepare('UPDATE otp_codes SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL').bind(now, userId, purpose),
    db.prepare('INSERT INTO otp_codes (user_id, purpose, salt, code_hash, expires_at, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userId, purpose, salt, await sha256Hex(salt + code), new Date(Date.now() + TTL_MS).toISOString(), ipHash || null, now)
  ])
  return { ok: true, code }
}

export type CheckResult = { ok: true } | { ok: false; reason: 'none' | 'expired' | 'locked' | 'wrong' }

/** Checks a code: 5 tries, 5 minutes, single use. */
export async function checkOtp(db: D1Database, userId: number, purpose: Purpose, code: string): Promise<CheckResult> {
  const row = await db.prepare('SELECT id, salt, code_hash, expires_at, tries FROM otp_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1').bind(userId, purpose).first<{ id: number; salt: string; code_hash: string; expires_at: string; tries: number }>()
  if (!row) return { ok: false, reason: 'none' }
  if (row.expires_at < new Date().toISOString()) return { ok: false, reason: 'expired' }
  if (row.tries >= MAX_TRIES) return { ok: false, reason: 'locked' }
  await db.prepare('UPDATE otp_codes SET tries = tries + 1 WHERE id = ?').bind(row.id).run()
  if ((await sha256Hex(row.salt + code.trim())) !== row.code_hash) return { ok: false, reason: 'wrong' }
  const claim = await db.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(new Date().toISOString(), row.id).run()
  return claim.meta.changes ? { ok: true } : { ok: false, reason: 'none' }
}

/** Sends the code through your own email/SMS service: POST {to, channel, code, purpose, app} to OTP_WEBHOOK_URL. Returns false when not configured. */
export async function deliverOtp(env: AppEnv['Bindings'], to: string, code: string, purpose: Purpose): Promise<boolean> {
  if (!env.OTP_WEBHOOK_URL) return false
  try {
    const r = await fetch(env.OTP_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.OTP_WEBHOOK_TOKEN ? { authorization: `Bearer ${env.OTP_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ to, channel: to.includes('@') ? 'email' : 'sms', code, purpose, app: env.OPERATOR_NAME || 'INSPIRE Academy' })
    })
    return r.ok
  } catch { return false }
}
