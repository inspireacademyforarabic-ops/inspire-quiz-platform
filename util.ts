export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function toInt(v: unknown, d = 0): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : d
}

export function toNum(v: unknown, d = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : d
}

export function bool(v: unknown): number {
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0
}

export function normalizeShortAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\r\n')
}

export async function logActivity(
  db: D1Database,
  actorId: number | null,
  type: string,
  message: string,
  refType?: string,
  refId?: number
) {
  await db
    .prepare('INSERT INTO activity_log (actor_id, type, message, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)')
    .bind(actorId, type, message, refType ?? null, refId ?? null)
    .run()
}
