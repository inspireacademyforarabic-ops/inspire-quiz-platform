import { hashPassword, randomToken } from './auth'

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** One-time reset token, shown once to the admin. Only its hash is stored; any older unused link is replaced. */
export async function createResetToken(db: D1Database, userId: number, createdBy: number | null, ttlHours = 24) {
  const token = randomToken(24)
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString()
  await db.batch([
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').bind(userId),
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?)').bind(userId, await sha256Hex(token), expiresAt, createdBy)
  ])
  return { token, expiresAt }
}

export type ResetResult = { ok: true; userId: number } | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'inactive' }

/** Sets a new password if the token is valid, unused and unexpired; signs the user out everywhere. */
export async function consumeResetToken(db: D1Database, token: string, newPassword: string): Promise<ResetResult> {
  const row = await db
    .prepare('SELECT r.id, r.user_id, r.expires_at, r.used_at, u.active FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?')
    .bind(await sha256Hex(token))
    .first<{ id: number; user_id: number; expires_at: string; used_at: string | null; active: number }>()
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.used_at) return { ok: false, reason: 'used' }
  if (row.expires_at < new Date().toISOString()) return { ok: false, reason: 'expired' }
  if (!row.active) return { ok: false, reason: 'inactive' }
  // Claim the token first so two simultaneous requests cannot both use it.
  const claim = await db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(new Date().toISOString(), row.id).run()
  if (!claim.meta.changes) return { ok: false, reason: 'used' }
  const salt = randomToken(16)
  const hash = await hashPassword(newPassword, salt)
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, row.user_id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id)
  ])
  return { ok: true, userId: row.user_id }
}

/** Account deletion: remove personal details and access, keep quiz results without identifying details. */
export async function anonymiseUser(db: D1Database, userId: number) {
  const salt = randomToken(16)
  const hash = await hashPassword(randomToken(24), salt)
  await db.batch([
    db.prepare("UPDATE users SET email = ?, name = 'Deleted student', password_hash = ?, salt = ?, active = 0, telegram_id = NULL, is_premium = 0, phone = NULL, target_exam = NULL, state = NULL, city = NULL, qualification = NULL, consent_at = NULL WHERE id = ?").bind(`deleted-${userId}@deleted.invalid`, hash, salt, userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM batch_members WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM quiz_assignments WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(userId),
    db.prepare("UPDATE activity_log SET message = '[removed]' WHERE actor_id = ?").bind(userId)
  ])
}
