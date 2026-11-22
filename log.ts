import * as Sentry from '@sentry/cloudflare'
import { HTTPException } from 'hono/http-exception'
import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'

// Keys whose values must never reach a log line (LOGS Kit, camera 5).
const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|otp|card|cvv|aadhaar|passport|session|salt|hash/i
type Level = 'info' | 'warn' | 'error'
type Attrs = Record<string, unknown>

/** Flatten to primitives, redact secret-looking keys, and drop whole objects (they carry everything). */
export function scrub(a: Attrs = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null) continue
    if (SECRET_KEY.test(k)) { out[k] = '[redacted]'; continue }
    out[k] = typeof v === 'number' || typeof v === 'boolean' ? v : typeof v === 'object' ? '[object omitted]' : String(v).slice(0, 300)
  }
  return out
}

/** For Sentry's own log objects: blank out secret-looking keys, leave everything else untouched. */
export function redactKeys(a: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : v]))
}

function emit(level: Level, message: string, attrs?: Attrs) {
  const a = scrub(attrs)
  // One JSON line to the console (Cloudflare real-time logs) and the same fields to Sentry Logs (kept for days).
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, message, ...a, at: new Date().toISOString() }))
  try { Sentry.logger[level](message, a) } catch { /* logging must never break a request */ }
}

export const log = {
  info: (m: string, a?: Attrs) => emit('info', m, a),
  warn: (m: string, a?: Attrs) => emit('warn', m, a),
  error: (m: string, a?: Attrs) => emit('error', m, a)
}

/** Logger bound to the current request: every line carries requestId and (when signed in) userId. */
export function lg(c: Context<AppEnv>) {
  const base = (): Attrs => ({ requestId: c.get('requestId'), userId: c.get('user')?.id })
  return {
    info: (m: string, a?: Attrs) => emit('info', m, { ...base(), ...a }),
    warn: (m: string, a?: Attrs) => emit('warn', m, { ...base(), ...a }),
    error: (m: string, a?: Attrs) => emit('error', m, { ...base(), ...a })
  }
}

/** Assigns a requestId to every request and writes one access line per API call. */
export async function requestLog(c: Context<AppEnv>, next: Next) {
  const id = c.req.header('x-request-id') || crypto.randomUUID()
  c.set('requestId', id)
  c.header('x-request-id', id)
  const t = Date.now()
  await next()
  const path = new URL(c.req.url).pathname
  if (!path.startsWith('/api/')) return
  const s = c.res.status
  emit(s >= 500 ? 'error' : s >= 400 ? 'warn' : 'info', `${c.req.method} ${path} ${s}`, { requestId: id, userId: c.get('user')?.id, status: s, ms: Date.now() - t })
}

/** Last-resort handler: log with context, report to Sentry, and give the user a code to quote. */
export function onError(err: Error, c: Context<AppEnv>) {
  if (err instanceof HTTPException) return err.getResponse()
  const id = c.get('requestId')
  emit('error', 'unhandled error', { requestId: id, userId: c.get('user')?.id, method: c.req.method, path: new URL(c.req.url).pathname, error: err.message })
  Sentry.withScope((scope) => {
    scope.setTag('requestId', id)
    const u = c.get('user')
    if (u) scope.setUser({ id: String(u.id) })
    Sentry.captureException(err)
  })
  c.header('x-request-id', id)
  return c.json({ error: `Something went wrong on our side. If you contact us, quote this code: ${id}`, requestId: id }, 500)
}
