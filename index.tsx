import { Hono } from 'hono'
import type { AnswerRecord, AppEnv, OrderItem } from './types'
import auth from './routes/auth'
import legal from './routes/legal'
import { createResetToken } from './lib/account'
import { attachUser, hashPassword, randomToken, requireRole } from './lib/auth'
import { attemptSummary, buildReview, checkAccess, evaluate, getAttempt, getQuiz, getQuizQuestions, isAttemptExpired, publicQuestion, scoreAttempt, startAttempt } from './lib/quiz'
import { normalizeDraft, parseCsv, parseQuestionText } from './lib/parser'
import { aiConfigured, generateQuestions } from './lib/ai'
import { bool, logActivity, safeJson, toCsv, toInt, toNum } from './lib/util'
import * as Sentry from '@sentry/cloudflare'
import { lg, log, onError, redactKeys, requestLog } from './lib/log'

const app = new Hono<AppEnv>()
const staff = requireRole('admin', 'creator')
const stu = requireRole('student')

app.use('*', requestLog) // requestId + one access-log line per API call
app.onError(onError) // unhandled errors: logged, sent to Sentry, user gets a code to quote

/* ---------- demo data (runs once, on an empty database) ---------- */
let seeded = false
async function seed(db: D1Database, env: AppEnv['Bindings'], host: string) {
  if (seeded) return
  if ((await db.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>())?.n) { seeded = true; return }
  // Demo data (with its publicly documented password) only on localhost or when DEMO_MODE=true.
  const demo = env.DEMO_MODE === 'true' || host === 'localhost' || host === '127.0.0.1'
  if (!demo) {
    if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8) {
      const s = randomToken(16)
      await db.prepare('INSERT INTO users (id,email,name,role,password_hash,salt) VALUES (1,?,?,?,?,?)').bind(env.ADMIN_EMAIL.trim().toLowerCase(), 'Administrator', 'admin', await hashPassword(env.ADMIN_PASSWORD, s), s).run()
      seeded = true
      log.info('first admin account created')
    } else log.error('no users yet: set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) so the first admin can sign in')
    return
  }
  seeded = true
  const salt = randomToken(16)
  const hash = await hashPassword('Inspire@123', salt) // demo password for every demo account
  const names = ['Academy Admin', 'Aisha Rahman', 'Bilal Khan', 'Fatima Noor', 'Hamza Ali', 'Maryam Siddiqui']
  const S: D1PreparedStatement[] = names.map((n, i) =>
    db.prepare('INSERT INTO users (id,email,name,role,password_hash,salt,is_premium) VALUES (?,?,?,?,?,?,?)')
      .bind(i + 1, i ? `student${i}@inspire.academy` : 'admin@inspire.academy', n, i ? 'student' : 'admin', hash, salt, i === 2 ? 1 : 0))
  S.push(db.prepare("INSERT INTO batches (id,name,description,created_by) VALUES (1,'UGC NET Arabic 2026','Morning batch',1)"))
  for (const u of [2, 3, 4]) S.push(db.prepare('INSERT INTO batch_members VALUES (1,?)').bind(u))
  const T = 'Arabic Literature'
  const Q: [string, string, string[], any[], string, string, string][] = [
    ['mcq', "Who composed the Mu'allaqa that opens with “Qifa nabki”?", ["Imru' al-Qais", 'Antara', 'Labid', 'Tarafa'], [0], "It is the opening of Imru' al-Qais's famous ode.", 'Pre-Islamic poetry', 'easy'],
    ['mcq', "How many odes are traditionally collected as the Mu'allaqat?", ['Five', 'Seven', 'Nine', 'Twelve'], [1], 'The classic collection (Hammad al-Rawiya) lists seven.', 'Pre-Islamic poetry', 'easy'],
    ['mcq', "Which Mu'allaqa begins “Amin Umm Awfa dimnatun lam takallami”?", ['Zuhayr', 'Amr ibn Kulthum', 'Al-Harith', 'Al-Nabigha'], [0], 'Zuhayr ibn Abi Sulma, poet of wisdom (hikma).', 'Pre-Islamic poetry', 'medium'],
    ['true_false', "Al-Khansa' is chiefly famous for her love poetry (ghazal).", ['True', 'False'], [1], "She is famous for rithā' (elegies) on her brothers.", 'Pre-Islamic poetry', 'medium'],
    ['short_answer', 'Name the poetic genre in which Abu Nuwas excelled for wine poetry.', [], ['khamriyyat', 'khamriyyah', 'khamriyya'], 'Khamriyyat = wine poems.', 'Abbasid poetry', 'medium'],
    ['mcq', 'Who translated Kalila wa Dimna into Arabic prose?', ["Ibn al-Muqaffa'", 'Al-Jahiz', 'Al-Hariri', 'Ibn Qutayba'], [0], "Ibn al-Muqaffa' made the classic Arabic version.", 'Abbasid prose', 'easy'],
    ['mcq', 'Which work is by Al-Jahiz?', ['Kitab al-Hayawan', 'Risalat al-Ghufran', 'Al-Maqamat', 'Kitab al-Aghani'], [0], 'The Book of Animals.', 'Abbasid prose', 'easy'],
    ['mcq', 'Who is regarded as the pioneer of the Maqama genre?', ['Al-Hamadhani', 'Al-Hariri', 'Ibn Duraid', 'Al-Tawhidi'], [0], "Badi' al-Zaman al-Hamadhani.", 'Abbasid prose', 'medium'],
    ['short_answer', 'Name the author of Al-Bayan wa al-Tabyin.', [], ['al-jahiz', 'jahiz', 'aljahiz'], 'A foundational work on rhetoric by Al-Jahiz.', 'Abbasid prose', 'medium'],
    ['true_false', 'Al-Mutanabbi belongs to the Abbasid period.', ['True', 'False'], [0], 'He lived c. 915–965 CE.', 'Abbasid poetry', 'easy'],
    ['mcq', 'Who wrote Risalat al-Ghufran?', ["Abu al-'Ala al-Ma'arri", 'Al-Buhturi', 'Ibn al-Rumi', 'Abu Tammam'], [0], 'A satirical journey through the afterlife.', 'Abbasid prose', 'hard'],
    ['mcq', 'Which city was founded in 762 CE as the Abbasid capital?', ['Baghdad', 'Damascus', 'Cairo', 'Kufa'], [0], 'Founded by al-Mansur.', 'Abbasid history', 'easy']
  ]
  Q.forEach((q, i) => S.push(db.prepare('INSERT INTO questions (id,type,text,options_json,correct_json,explanation,subject,topic,difficulty,created_by) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .bind(i + 1, q[0], q[1], JSON.stringify(q[2]), JSON.stringify(q[3]), q[4], T, q[5], q[6])))
  const qz = db.prepare('INSERT INTO quizzes (id,title,description,instructions,subject,topic,difficulty,status,mode,duration_minutes,attempt_limit,pass_mark,negative_marks,shuffle_questions,shuffle_options,access_type,premium_only,created_by,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)')
  const now = new Date().toISOString()
  S.push(qz.bind(1, 'Pre-Islamic Poetry Basics', 'Mu’allaqat and major poets.', 'Read each question carefully. Wrong answers cost 0.25 marks.', T, 'Pre-Islamic poetry', 'easy', 'published', 'exam', 20, 3, 40, 0.25, 1, 0, 'free', 0, now))
  S.push(qz.bind(2, 'Abbasid Prose & Poetry Practice', 'Practice set with instant feedback.', 'Answers are shown right after you respond.', T, 'Abbasid era', 'medium', 'published', 'both', null, 0, 40, 0, 0, 0, 'restricted', 0, now))
  S.push(qz.bind(3, 'Maqamat Deep Dive (draft)', 'Work in progress.', null, T, 'Maqamat', 'hard', 'draft', 'exam', 30, 1, 50, 0, 0, 0, 'free', 0, null))
  Q.forEach((_, i) => S.push(db.prepare('INSERT INTO quiz_questions (quiz_id,question_id,position) VALUES (?,?,?)').bind(i < 5 ? 1 : 2, i + 1, i)))
  S.push(db.prepare('INSERT INTO quiz_assignments (quiz_id,batch_id) VALUES (2,1)'))
  for (let i = 0; i < 10; i++) {
    const pct = [40, 60, 80, 100, 60, 80, 20, 100, 80, 60][i], when = new Date(Date.now() - (13 - i) * 86400_000).toISOString()
    S.push(db.prepare("INSERT INTO attempts (quiz_id,user_id,mode,status,order_json,started_at,submitted_at,score,max_score,percent,correct_count,wrong_count,unanswered_count,passed,time_taken_sec) VALUES (1,?,'exam','submitted','[]',?,?,?,5,?,?,?,0,?,?)")
      .bind(2 + (i % 5), when, when, pct / 20, pct, pct / 20, 5 - pct / 20, pct >= 40 ? 1 : 0, 300 + i * 40))
    S.push(db.prepare("INSERT INTO activity_log (actor_id,type,message,created_at) VALUES (?,'attempt_submitted',?,?)").bind(2 + (i % 5), `${names[1 + (i % 5)]} scored ${pct}% on “Pre-Islamic Poetry Basics”`, when))
  }
  await db.batch(S)
  log.info('demo data seeded', { users: names.length, quizzes: 3, questions: Q.length })
}

app.use('/api/*', async (c, next) => { await seed(c.env.DB, c.env, new URL(c.req.url).hostname); await next() })
app.use('/api/*', attachUser)
app.route('/api/auth', auth)
app.get('/api/health', (c) => c.json({ ok: true, at: new Date().toISOString() })) // for uptime checks

/* ---------- staff: overview, meta, settings ---------- */
app.get('/api/staff/overview', staff, async (c) => {
  const db = c.env.DB
  const t = await db.prepare(`SELECT (SELECT COUNT(*) FROM quizzes WHERE status!='archived') quizzes, (SELECT COUNT(*) FROM users WHERE role='student' AND active=1) students,
    (SELECT COUNT(*) FROM attempts WHERE status!='in_progress') attempts, (SELECT ROUND(AVG(percent),1) FROM attempts WHERE status='submitted') avg`).first()
  const days = (await db.prepare(`SELECT substr(submitted_at,1,10) d, COUNT(*) n, ROUND(AVG(percent),1) a FROM attempts WHERE status='submitted' AND submitted_at >= date('now','-14 day') GROUP BY d ORDER BY d`).all()).results
  const activity = (await db.prepare('SELECT message, created_at FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 8').all()).results
  return c.json({ totals: t, days, activity })
})
app.get('/api/staff/meta', staff, async (c) => {
  const db = c.env.DB
  return c.json({
    students: (await db.prepare("SELECT u.id,u.name,u.email,u.phone,u.target_exam,u.state,u.city,u.qualification,u.created_at,u.is_premium,u.last_login_at,(SELECT COUNT(*) FROM attempts a WHERE a.user_id=u.id AND a.status!='in_progress') attempts,(SELECT ROUND(AVG(percent),1) FROM attempts a WHERE a.user_id=u.id AND a.status='submitted') avg FROM users u WHERE role='student' ORDER BY name").all()).results,
    batches: (await db.prepare('SELECT id,name FROM batches ORDER BY name').all()).results
  })
})
app.get('/api/staff/students.csv', staff, async (c) => {
  const rows = (await c.env.DB.prepare("SELECT u.name,u.email,u.phone,u.target_exam,u.state,u.city,u.qualification,u.created_at,u.is_premium,u.active,(SELECT COUNT(*) FROM attempts a WHERE a.user_id=u.id AND a.status!='in_progress') attempts FROM users u WHERE u.role='student' AND u.email NOT LIKE 'deleted-%@deleted.invalid' ORDER BY u.name").all()).results as any[]
  lg(c).info('students exported', { rows: rows.length })
  c.header('content-type', 'text/csv; charset=utf-8'); c.header('content-disposition', 'attachment; filename="inspire-students.csv"')
  return c.body(toCsv(['Name', 'Email', 'Phone', 'Exam', 'State', 'City', 'Qualification', 'Joined', 'Plan', 'Active', 'Attempts'], rows.map((r) => [r.name, r.email, r.phone, r.target_exam, r.state, r.city, r.qualification, r.created_at, r.is_premium ? 'Premium' : 'Free', r.active ? 'Yes' : 'No', r.attempts])))
})
app.post('/api/staff/students/:id/reset-link', staff, async (c) => {
  const id = toInt(c.req.param('id'))
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'student' AND active = 1").bind(id).first()
  if (!target) return c.json({ error: 'Student not found' }, 404)
  const { token, expiresAt } = await createResetToken(c.env.DB, id, c.get('user').id)
  lg(c).info('password reset link created', { targetUserId: id, expiresAt })
  const base = (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, '')
  return c.json({ url: `${base}/#/reset/${token}`, expires_at: expiresAt })
})
app.get('/api/staff/settings', staff, (c) => c.json({ ai: aiConfigured(c.env), telegram: Boolean(c.env.TELEGRAM_BOT_TOKEN), monitoring: Boolean(c.env.SENTRY_DSN), otp: Boolean(c.env.OTP_WEBHOOK_URL), payments: false }))
// 5-minute test (docs/LOGS-KIT.md): proves an error reaches Sentry with its requestId. Staff only.
app.get('/api/staff/_test-error', staff, (c) => { lg(c).error('test error requested'); throw new Error('Test error from /api/staff/_test-error') })
// Browser-side errors from signed-in users (message/page/line only; capped and scrubbed).
app.post('/api/client-error', async (c) => {
  if (!c.get('user')) return c.json({ error: 'Authentication required' }, 401)
  const b = await c.req.json().catch(() => ({}))
  lg(c).error('browser error', { message: b.message, page: b.page, line: b.line, browser: c.req.header('user-agent') })
  return c.json({ ok: true })
})

/* ---------- staff: question bank ---------- */
app.get('/api/staff/questions', staff, async (c) => {
  const { q, subject, type, difficulty } = c.req.query()
  const w: string[] = [], b: unknown[] = []
  if (q) { w.push('(text LIKE ? OR topic LIKE ?)'); b.push(`%${q}%`, `%${q}%`) }
  if (subject) { w.push('subject = ?'); b.push(subject) }
  if (type) { w.push('type = ?'); b.push(type) }
  if (difficulty) { w.push('difficulty = ?'); b.push(difficulty) }
  const r = await c.env.DB.prepare(`SELECT * FROM questions ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).bind(...b).all()
  return c.json({ questions: r.results })
})
app.post('/api/staff/questions', staff, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const list = (Array.isArray(body.questions) ? body.questions : [body]).map(normalizeDraft).filter(Boolean) as any[]
  if (!list.length) return c.json({ error: 'No valid question found. Check the text, options and correct answer.' }, 400)
  const u = c.get('user'), ids: number[] = []
  for (const d of list) {
    const r = await c.env.DB.prepare('INSERT INTO questions (type,text,options_json,correct_json,explanation,subject,topic,difficulty,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(d.type, d.text, JSON.stringify(d.options ?? []), JSON.stringify(d.correct), d.explanation, d.subject ?? body.subject ?? null, d.topic ?? body.topic ?? null, d.difficulty ?? 'medium', u.id).run()
    ids.push(r.meta.last_row_id as number)
  }
  lg(c).info('questions added', { count: ids.length })
  return c.json({ ids })
})
app.delete('/api/staff/questions/:id', staff, async (c) => { await c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(toInt(c.req.param('id'))).run(); return c.json({ ok: true }) })
// Import / AI return drafts only; nothing is saved until the creator reviews them and posts to /questions.
app.post('/api/staff/import', staff, async (c) => {
  const { text = '', format = 'text' } = await c.req.json().catch(() => ({}))
  return c.json(format === 'csv' ? parseCsv(String(text)) : parseQuestionText(String(text)))
})
app.post('/api/staff/ai', staff, async (c) => {
  if (!aiConfigured(c.env)) { lg(c).warn('ai generation unavailable', { reason: 'no_api_key' }); return c.json({ error: 'AI generation needs an OPENAI_API_KEY secret (see README). Import and manual entry still work.' }, 503) }
  const b = await c.req.json().catch(() => ({}))
  try { return c.json({ questions: await generateQuestions(c.env, { topic: String(b.topic ?? ''), subject: b.subject, count: toInt(b.count, 5), difficulty: b.difficulty ?? 'mixed', types: ['mcq'] }) }) }
  catch (e: any) { lg(c).error('ai generation failed', { topic: String(b.topic ?? '').slice(0, 80), error: e?.message }); return c.json({ error: e.message || 'AI request failed' }, 502) }
})

/* ---------- staff: quizzes ---------- */
const NUM = ['duration_minutes', 'attempt_limit', 'pass_mark', 'marks_per_question', 'negative_marks', 'price']
const BOOL = ['shuffle_questions', 'shuffle_options', 'show_answers', 'is_paid', 'premium_only']
const TXT = ['title', 'description', 'instructions', 'subject', 'topic', 'difficulty', 'status', 'mode', 'start_at', 'end_at', 'access_type']
async function saveQuiz(db: D1Database, id: number | null, b: any, uid: number) {
  const f: Record<string, unknown> = {}
  for (const k of TXT) if (k in b) f[k] = b[k] === '' ? null : String(b[k] ?? '')
  for (const k of NUM) if (k in b) f[k] = b[k] === '' || b[k] === null ? (k === 'duration_minutes' ? null : 0) : toNum(b[k])
  for (const k of BOOL) if (k in b) f[k] = bool(b[k])
  if (f.status === 'published') f.published_at = new Date().toISOString()
  if (id === null) { f.title = f.title || 'Untitled quiz'; f.created_by = uid }
  const keys = Object.keys(f)
  if (id === null) { const r = await db.prepare(`INSERT INTO quizzes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map((k) => f[k])).run(); return r.meta.last_row_id as number }
  if (keys.length) await db.prepare(`UPDATE quizzes SET ${keys.map((k) => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`).bind(...keys.map((k) => f[k]), id).run()
  return id
}
app.get('/api/staff/quizzes', staff, async (c) => {
  const r = await c.env.DB.prepare(`SELECT z.*, (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id=z.id) question_count, (SELECT COUNT(*) FROM attempts WHERE quiz_id=z.id AND status!='in_progress') attempts FROM quizzes z ORDER BY z.updated_at DESC, z.id DESC`).all()
  return c.json({ quizzes: r.results })
})
app.get('/api/staff/quizzes/:id', staff, async (c) => {
  const id = toInt(c.req.param('id')), quiz = await getQuiz(c.env.DB, id)
  if (!quiz) return c.json({ error: 'Quiz not found' }, 404)
  const asg = (await c.env.DB.prepare('SELECT user_id, batch_id FROM quiz_assignments WHERE quiz_id = ?').bind(id).all<{ user_id: number | null; batch_id: number | null }>()).results
  return c.json({ quiz, questions: await getQuizQuestions(c.env.DB, id), user_ids: asg.filter((a) => a.user_id).map((a) => a.user_id), batch_ids: asg.filter((a) => a.batch_id).map((a) => a.batch_id) })
})
app.post('/api/staff/quizzes', staff, async (c) => {
  const b = await c.req.json().catch(() => ({})), id = await saveQuiz(c.env.DB, null, { ...b, status: 'draft' }, c.get('user').id)
  await logActivity(c.env.DB, c.get('user').id, 'quiz_created', `Quiz “${b.title || 'Untitled quiz'}” created`, 'quiz', id)
  lg(c).info('quiz created', { quizId: id })
  return c.json({ id })
})
app.put('/api/staff/quizzes/:id', staff, async (c) => {
  const db = c.env.DB, id = toInt(c.req.param('id')), b = await c.req.json().catch(() => ({}))
  if (!(await getQuiz(db, id))) return c.json({ error: 'Quiz not found' }, 404)
  if (b.status === 'published') {
    const n = Array.isArray(b.question_ids) ? b.question_ids.length : (await db.prepare('SELECT COUNT(*) n FROM quiz_questions WHERE quiz_id=?').bind(id).first<{ n: number }>())?.n ?? 0
    if (!n) return c.json({ error: 'Add at least one question before publishing.' }, 400)
  }
  await saveQuiz(db, id, b, c.get('user').id)
  const S: D1PreparedStatement[] = []
  if (Array.isArray(b.question_ids)) {
    S.push(db.prepare('DELETE FROM quiz_questions WHERE quiz_id=?').bind(id))
    b.question_ids.forEach((q: number, i: number) => S.push(db.prepare('INSERT OR IGNORE INTO quiz_questions (quiz_id,question_id,position) VALUES (?,?,?)').bind(id, toInt(q), i)))
  }
  if (Array.isArray(b.user_ids) || Array.isArray(b.batch_ids)) {
    S.push(db.prepare('DELETE FROM quiz_assignments WHERE quiz_id=?').bind(id))
    for (const u of b.user_ids ?? []) S.push(db.prepare('INSERT INTO quiz_assignments (quiz_id,user_id) VALUES (?,?)').bind(id, toInt(u)))
    for (const g of b.batch_ids ?? []) S.push(db.prepare('INSERT INTO quiz_assignments (quiz_id,batch_id) VALUES (?,?)').bind(id, toInt(g)))
  }
  if (S.length) await db.batch(S)
  if (b.status) await logActivity(db, c.get('user').id, 'quiz_status', `Quiz #${id} set to ${b.status}`, 'quiz', id)
  lg(c).info('quiz updated', { quizId: id, status: b.status ?? 'unchanged', questions: Array.isArray(b.question_ids) ? b.question_ids.length : 'unchanged' })
  return c.json({ ok: true })
})
app.post('/api/staff/quizzes/:id/duplicate', staff, async (c) => {
  const db = c.env.DB, id = toInt(c.req.param('id')), q = await getQuiz(db, id)
  if (!q) return c.json({ error: 'Quiz not found' }, 404)
  const nid = await saveQuiz(db, null, { ...q, title: q.title + ' (copy)', status: 'draft' }, c.get('user').id)
  await db.prepare('INSERT INTO quiz_questions (quiz_id,question_id,position,marks) SELECT ?,question_id,position,marks FROM quiz_questions WHERE quiz_id=?').bind(nid, id).run()
  lg(c).info('quiz duplicated', { quizId: id, newQuizId: nid })
  return c.json({ id: nid })
})

/* ---------- staff: results (+CSV) ---------- */
app.get('/api/staff/results', staff, async (c) => {
  const { quiz_id, user_id, from, format } = c.req.query()
  const w = ["a.status!='in_progress'"], b: unknown[] = []
  if (quiz_id) { w.push('a.quiz_id=?'); b.push(toInt(quiz_id)) }
  if (user_id) { w.push('a.user_id=?'); b.push(toInt(user_id)) }
  if (from) { w.push('a.submitted_at >= ?'); b.push(from) }
  const rows = (await c.env.DB.prepare(`SELECT a.id,u.name student,u.email,z.title quiz,z.subject,a.mode,a.submitted_at,a.score,a.max_score,a.percent,a.passed,a.time_taken_sec FROM attempts a JOIN users u ON u.id=a.user_id JOIN quizzes z ON z.id=a.quiz_id WHERE ${w.join(' AND ')} ORDER BY a.submitted_at DESC LIMIT 1000`).bind(...b).all<any>()).results
  if (format === 'csv') {
    lg(c).info('results exported', { rows: rows.length })
    c.header('content-type', 'text/csv; charset=utf-8'); c.header('content-disposition', 'attachment; filename="inspire-results.csv"')
    return c.body(toCsv(['Student', 'Email', 'Quiz', 'Subject', 'Mode', 'Submitted', 'Score', 'Max', 'Percent', 'Result', 'Seconds'], rows.map((r) => [r.student, r.email, r.quiz, r.subject, r.mode, r.submitted_at, r.score, r.max_score, r.percent, r.passed ? 'Pass' : 'Fail', r.time_taken_sec])))
  }
  const dist = [0, 0, 0, 0, 0]; rows.forEach((r) => { dist[Math.min(4, Math.floor((r.percent ?? 0) / 20))]++ })
  return c.json({ rows, dist })
})

/* ---------- student ---------- */
app.get('/api/student/home', stu, async (c) => {
  const db = c.env.DB, u = c.get('user')
  const quizzes = (await db.prepare("SELECT id,title,description,instructions,subject,topic,difficulty,mode,duration_minutes,end_at,pass_mark,is_paid,premium_only,(SELECT COUNT(*) FROM quiz_questions WHERE quiz_id=quizzes.id) question_count FROM quizzes WHERE status='published' ORDER BY id").all<any>()).results
  const out: any[] = []
  for (const z of quizzes) {
    const acc = await checkAccess(db, (await getQuiz(db, z.id))!, u)
    if (acc.code === 'not_assigned') continue // restricted quizzes stay invisible to unassigned students
    out.push({ ...z, allowed: acc.allowed, reason: acc.reason ?? null, attempts_left: acc.attempts_left, resume_id: acc.in_progress_attempt_id })
  }
  const recent = (await db.prepare("SELECT a.id,z.title,a.mode,a.percent,a.passed,a.submitted_at FROM attempts a JOIN quizzes z ON z.id=a.quiz_id WHERE a.user_id=? AND a.status!='in_progress' ORDER BY a.submitted_at DESC LIMIT 10").bind(u.id).all()).results
  return c.json({ quizzes: out, recent })
})

async function payload(db: D1Database, a: any, quiz: any) {
  const order = safeJson<OrderItem[]>(a.order_json, []), ans = safeJson<Record<string, AnswerRecord>>(a.answers_json, {})
  const m = new Map((await getQuizQuestions(db, quiz.id)).map((q) => [q.id, q]))
  const questions = order.map((it, i) => (m.has(it.question_id) ? publicQuestion(m.get(it.question_id)!, it, i) : null)).filter(Boolean)
  const answers: Record<string, any> = {}
  for (const it of order) {
    const r = ans[String(it.question_id)]; if (!r) continue
    const o: any = { selected: r.selected ?? [], text: r.text ?? '', flagged: !!r.flagged }
    if (a.mode === 'practice' && (o.selected.length || o.text)) { const q = m.get(it.question_id)!, ev = evaluate(q, it, r); o.correct = ev.correct; o.correct_options = ev.correctDisplayed; o.explanation = q.explanation }
    answers[it.question_id] = o
  }
  return { attempt: { id: a.id, mode: a.mode, status: a.status, deadline_at: a.deadline_at, quiz_title: quiz.title, instructions: quiz.instructions }, questions, answers }
}
async function ownAttempt(c: any) {
  const a = await getAttempt(c.env.DB, toInt(c.req.param('id')))
  if (!a || a.user_id !== c.get('user').id) return null
  return { a, quiz: (await getQuiz(c.env.DB, a.quiz_id))! }
}
const reveal = (a: any, quiz: any) => a.mode === 'practice' || Boolean(quiz.show_answers)

app.post('/api/student/quizzes/:id/start', stu, async (c) => {
  const db = c.env.DB, u = c.get('user'), quiz = await getQuiz(db, toInt(c.req.param('id')))
  if (!quiz) return c.json({ error: 'Quiz not found' }, 404)
  const acc = await checkAccess(db, quiz, u) // server-side: status, dates, assignment, premium, payment, attempt limit
  if (!acc.allowed) { lg(c).warn('quiz access denied', { quizId: quiz.id, code: acc.code }); return c.json({ error: acc.reason, code: acc.code }, 403) }
  if (acc.in_progress_attempt_id) return c.json({ attempt_id: acc.in_progress_attempt_id })
  const { mode } = await c.req.json().catch(() => ({ mode: 'exam' }))
  const m = quiz.mode === 'both' ? (mode === 'practice' ? 'practice' : 'exam') : quiz.mode
  try {
    const at = await startAttempt(db, quiz, u, m)
    lg(c).info('attempt started', { quizId: quiz.id, attemptId: at.id, mode: m })
    return c.json({ attempt_id: at.id })
  } catch (e: any) {
    lg(c).error('attempt start failed', { quizId: quiz.id, error: e?.message })
    return c.json({ error: e.message }, 400)
  }
})
app.get('/api/student/attempts/:id', stu, async (c) => {
  const o = await ownAttempt(c); if (!o) return c.json({ error: 'Attempt not found' }, 404)
  if (o.a.status === 'in_progress' && isAttemptExpired(o.a)) { await scoreAttempt(c.env.DB, o.a, o.quiz, 'expired'); lg(c).info('attempt auto-submitted', { attemptId: o.a.id, reason: 'time_up' }) }
  const a = (await getAttempt(c.env.DB, o.a.id))!
  if (a.status !== 'in_progress') return c.json({ done: true, ...(await buildReview(c.env.DB, a, o.quiz, reveal(a, o.quiz))) })
  return c.json(await payload(c.env.DB, a, o.quiz))
})
app.post('/api/student/attempts/:id/answer', stu, async (c) => {
  const o = await ownAttempt(c); if (!o) return c.json({ error: 'Attempt not found' }, 404)
  const { a, quiz } = o, db = c.env.DB
  if (a.status !== 'in_progress') return c.json({ error: 'This attempt has already been submitted.' }, 409)
  if (isAttemptExpired(a)) { await scoreAttempt(db, a, quiz, 'expired'); lg(c).info('attempt auto-submitted', { attemptId: a.id, reason: 'time_up' }); return c.json({ error: 'Time is up. Your attempt was submitted automatically.', code: 'expired' }, 410) }
  const b = await c.req.json().catch(() => ({})), qid = toInt(b.question_id)
  if (!safeJson<OrderItem[]>(a.order_json, []).some((i) => i.question_id === qid)) return c.json({ error: 'Unknown question' }, 400)
  const ans = safeJson<Record<string, AnswerRecord>>(a.answers_json, {}), cur = ans[String(qid)] ?? {}
  const locked = a.mode === 'practice' && (cur.selected?.length || cur.text) // practice answers are final so feedback can't be probed
  const next: AnswerRecord = { ...cur, flagged: b.flagged === undefined ? cur.flagged : Boolean(b.flagged), answered_at: new Date().toISOString() }
  if (!locked) { if (Array.isArray(b.selected)) next.selected = b.selected.map((x: unknown) => toInt(x, -1)).filter((x: number) => x >= 0).slice(0, 10); if (typeof b.text === 'string') next.text = b.text.slice(0, 500) }
  ans[String(qid)] = next
  const json = JSON.stringify(ans)
  await db.prepare('UPDATE attempts SET answers_json=? WHERE id=?').bind(json, a.id).run()
  return c.json((await payload(db, { ...a, answers_json: json }, quiz)).answers[qid] ?? {})
})
app.post('/api/student/attempts/:id/submit', stu, async (c) => {
  const o = await ownAttempt(c); if (!o) return c.json({ error: 'Attempt not found' }, 404)
  if (o.a.status === 'in_progress') await scoreAttempt(c.env.DB, o.a, o.quiz, 'submitted')
  const a = (await getAttempt(c.env.DB, o.a.id))!
  if (o.a.status === 'in_progress') lg(c).info('attempt submitted', { attemptId: a.id, quizId: o.quiz.id, mode: a.mode, score: a.score, percent: Math.round(a.percent ?? 0), passed: Boolean(a.passed) })
  return c.json({ done: true, summary: attemptSummary(a), ...(await buildReview(c.env.DB, a, o.quiz, reveal(a, o.quiz))) })
})

app.route('/', legal)
// Page shell: INSPIRE icon, installable-app manifest and a social-share image (absolute URL built from the request).
app.get('/', (c) => {
  const origin = new URL(c.req.url).origin
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>INSPIRE Academy · Quizzes</title><meta name="description" content="Quizzes and mock tests for Arabic literature exam preparation."><meta name="theme-color" content="#0b1220"><meta property="og:type" content="website"><meta property="og:title" content="INSPIRE Academy · Quizzes"><meta property="og:description" content="Quizzes and mock tests for Arabic literature exam preparation."><meta property="og:image" content="${origin}/static/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" type="image/png" href="/static/favicon-64.png"><link rel="apple-touch-icon" href="/static/apple-touch-icon.png"><link rel="manifest" href="/static/site.webmanifest"><link rel="stylesheet" href="/static/style.css"></head><body><div id="app"></div><script src="/static/app.js"></script></body></html>`)
})

// withSentry reports unhandled errors and sends Sentry.logger lines. With no SENTRY_DSN it does nothing, so local runs are unaffected.
export default Sentry.withSentry(
  (env: AppEnv['Bindings']) => ({
    dsn: env.SENTRY_DSN,
    enableLogs: true,
    tracesSampleRate: 0.1,
    // Camera 5: nothing secret leaves the app, even if a future log line slips.
    beforeSendLog: (l: any) => ({ ...l, attributes: redactKeys(l.attributes) })
  }),
  app
)
