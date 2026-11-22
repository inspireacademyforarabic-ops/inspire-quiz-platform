import { Hono } from 'hono'
import type { AppEnv, User } from '../types'
import { createSession, destroySession, getUserFromRequest, hashPassword, randomToken, setSessionCookie, verifyPassword } from '../lib/auth'
import { logActivity } from '../lib/util'
import { lg } from '../lib/log'
import { anonymiseUser, consumeResetToken } from '../lib/account'
import { EXAMS, QUALS, STATES, parseDetails } from '../lib/details'
import { checkOtp, deliverOtp, findUserByIdentifier, issueOtp, phoneOf, sha256Hex, type Purpose } from '../lib/otp'

const auth = new Hono<AppEnv>()

const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, is_premium: Boolean(u.is_premium), telegram_linked: Boolean(u.telegram_id), phone: u.phone ?? '', target_exam: u.target_exam ?? '', state: u.state ?? '', city: u.city ?? '', qualification: u.qualification ?? '' })

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ident = String(body.identifier ?? body.email ?? '').trim()
  const password = String(body.password ?? '')
  if (!ident || !password) return c.json({ error: 'Email or phone number and password are required' }, 400)
  const found = await findUserByIdentifier(c.env.DB, ident) // email, or a 10-digit phone number
  const email = (found?.email ?? ident).toLowerCase()
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first<User & { password_hash: string; salt: string }>()
  if (!row || !row.active) { lg(c).warn('login failed', { reason: 'unknown_or_inactive', emailDomain: email.split('@')[1] }); return c.json({ error: 'Invalid email or password' }, 401) }
  const ok = await verifyPassword(password, row.salt, row.password_hash)
  if (!ok) { lg(c).warn('login failed', { reason: 'wrong_password', userId: row.id }); return c.json({ error: 'Invalid email or password' }, 401) }
  const token = await createSession(c.env.DB, row.id)
  setSessionCookie(c, token)
  lg(c).info('login ok', { userId: row.id, role: row.role })
  return c.json({ user: publicUser(row) })
})

auth.get('/options', (c) => c.json({ exams: EXAMS, qualifications: QUALS, states: STATES }))

auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'Enter a valid email address' }, 400)
  const det = parseDetails(body)
  if (!det.ok) return c.json({ error: det.error }, 400)
  const { name, phone, exam, state, city, qualification } = det.value
  if (body.agree !== true) return c.json({ error: 'Please accept the Terms and the Privacy Policy' }, 400)
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const setting = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'allow_self_registration'").first<{ value: string }>()
  if (setting && setting.value === 'false') { lg(c).warn('signup blocked', { reason: 'self_registration_disabled' }); return c.json({ error: 'Self-registration is disabled. Ask your academy administrator for an account.' }, 403) }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first()
  if (exists) return c.json({ error: 'An account with this email already exists' }, 409)
  if (phone && (await c.env.DB.prepare('SELECT id FROM users WHERE phone = ?').bind(phone).first())) return c.json({ error: 'An account with this phone number already exists' }, 409)
  const salt = randomToken(16)
  const hash = await hashPassword(password, salt)
  const res = await c.env.DB.prepare("INSERT INTO users (email, name, role, password_hash, salt, phone, target_exam, state, city, qualification, consent_at) VALUES (?, ?, 'student', ?, ?, ?, ?, ?, ?, ?, ?)").bind(email, name, hash, salt, phone, exam, state, city, qualification, new Date().toISOString()).run()
  const id = res.meta.last_row_id as number
  await logActivity(c.env.DB, id, 'student_joined', `${name} joined as a student`, 'user', id)
  const token = await createSession(c.env.DB, id)
  setSessionCookie(c, token)
  const user = await getUserFromRequest(c)
  lg(c).info('signup ok', { userId: id })
  return c.json({ user: user ? publicUser(user) : null })
})

auth.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

auth.get('/me', async (c) => {
  const user = await getUserFromRequest(c)
  if (!user) return c.json({ user: null })
  return c.json({ user: publicUser(user) })
})

auth.put('/profile', async (c) => {
  const user = await getUserFromRequest(c)
  if (!user) return c.json({ error: 'Please sign in' }, 401)
  if (user.role !== 'student') return c.json({ error: 'Only students have these details' }, 403)
  const det = parseDetails(await c.req.json().catch(() => ({})))
  if (!det.ok) return c.json({ error: det.error }, 400)
  const { name, phone, exam, state, city, qualification } = det.value
  if (await c.env.DB.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').bind(phone, user.id).first()) return c.json({ error: 'That phone number is used by another account' }, 409)
  await c.env.DB.prepare('UPDATE users SET name = ?, phone = ?, target_exam = ?, state = ?, city = ?, qualification = ? WHERE id = ?').bind(name, phone, exam, state, city, qualification, user.id).run()
  lg(c).info('profile updated', { userId: user.id })
  const fresh = await getUserFromRequest(c)
  return c.json({ user: fresh ? publicUser(fresh) : null })
})

auth.post('/change-password', async (c) => {
  const user = await getUserFromRequest(c)
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  const body = await c.req.json().catch(() => ({}))
  const current = String(body.current_password ?? '')
  const next = String(body.new_password ?? '')
  if (next.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400)
  const row = await c.env.DB.prepare('SELECT password_hash, salt FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string; salt: string }>()
  if (!row || !(await verifyPassword(current, row.salt, row.password_hash))) return c.json({ error: 'Current password is incorrect' }, 400)
  const salt = randomToken(16)
  const hash = await hashPassword(next, salt)
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, user.id).run()
  lg(c).info('password changed', { userId: user.id })
  return c.json({ ok: true })
})

// One-time reset link (created by an admin from the Students page). Signs the student out everywhere.
auth.post('/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const password = String(body.password ?? '')
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const r = await consumeResetToken(c.env.DB, String(body.token ?? ''), password)
  if (!r.ok) {
    lg(c).warn('password reset rejected', { reason: r.reason })
    return c.json({ error: 'This reset link is not valid any more. Ask your teacher for a new one.' }, 400)
  }
  lg(c).info('password reset completed', { userId: r.userId })
  return c.json({ ok: true })
})

// Students can delete their own account: personal details are removed, results are kept without them.
auth.delete('/me', async (c) => {
  const user = await getUserFromRequest(c)
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  if (user.role !== 'student') return c.json({ error: 'Staff accounts are removed by an administrator, not from here.' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const row = await c.env.DB.prepare('SELECT password_hash, salt FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string; salt: string }>()
  if (!row || !(await verifyPassword(String(body.password ?? ''), row.salt, row.password_hash))) {
    lg(c).warn('account deletion refused', { userId: user.id, reason: 'wrong_password' })
    return c.json({ error: 'Password is incorrect' }, 400)
  }
  await anonymiseUser(c.env.DB, user.id)
  await destroySession(c)
  lg(c).info('account deleted', { userId: user.id })
  return c.json({ ok: true })
})

// ---- One-time codes: sign in without a password, or reset a forgotten password ----
auth.post('/otp/request', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const idv = String(b.identifier ?? '').trim()
  const purpose: Purpose = b.purpose === 'reset' ? 'reset' : 'login'
  if (!idv || idv.length > 120) return c.json({ error: 'Enter your email or phone number' }, 400)
  const generic = { ok: true, message: 'If an account exists, a code has been sent.' }
  const u = await findUserByIdentifier(c.env.DB, idv)
  if (!u || !u.active) { lg(c).warn('otp requested for unknown account', { purpose }); return c.json(generic) } // same answer: no account probing
  const ip = c.req.header('cf-connecting-ip') || ''
  const r = await issueOtp(c.env.DB, u.id, purpose, ip ? await sha256Hex(ip) : '')
  if (!r.ok) {
    lg(c).warn('otp rate limited', { userId: u.id, purpose, reason: r.reason })
    return c.json({ error: r.reason === 'cooldown' ? 'Please wait 30 seconds before asking for another code.' : 'Too many codes requested. Try again in 15 minutes.' }, 429)
  }
  const host = new URL(c.req.url).hostname
  const demo = c.env.DEMO_MODE === 'true' || host === 'localhost' || host === '127.0.0.1'
  const to = idv.includes('@') ? u.email : u.phone
  const sent = to ? await deliverOtp(c.env, to, r.code, purpose) : false
  if (!sent && !demo) lg(c).error('otp could not be delivered: set OTP_WEBHOOK_URL', { userId: u.id })
  lg(c).info('otp issued', { userId: u.id, purpose, delivered: sent })
  return c.json(demo ? { ...generic, dev_code: r.code } : generic) // the code is returned only on localhost or when DEMO_MODE=true
})
auth.post('/otp/login', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const u = await findUserByIdentifier(c.env.DB, String(b.identifier ?? ''))
  const bad = () => c.json({ error: 'That code is not correct or has expired.' }, 400)
  if (!u || !u.active) return bad()
  const r = await checkOtp(c.env.DB, u.id, 'login', String(b.code ?? ''))
  if (!r.ok) { lg(c).warn('otp login failed', { userId: u.id, reason: r.reason }); return bad() }
  const token = await createSession(c.env.DB, u.id)
  setSessionCookie(c, token)
  lg(c).info('login ok', { userId: u.id, method: 'otp' })
  const user = await getUserFromRequest(c)
  return c.json({ user: user ? publicUser(user) : null })
})
auth.post('/otp/reset', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const password = String(b.password ?? '')
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const u = await findUserByIdentifier(c.env.DB, String(b.identifier ?? ''))
  const bad = () => c.json({ error: 'That code is not correct or has expired.' }, 400)
  if (!u || !u.active) return bad()
  const r = await checkOtp(c.env.DB, u.id, 'reset', String(b.code ?? ''))
  if (!r.ok) { lg(c).warn('otp reset failed', { userId: u.id, reason: r.reason }); return bad() }
  const salt = randomToken(16)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(await hashPassword(password, salt), salt, u.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id)
  ])
  lg(c).info('password reset with otp', { userId: u.id })
  return c.json({ ok: true })
})

export default auth
