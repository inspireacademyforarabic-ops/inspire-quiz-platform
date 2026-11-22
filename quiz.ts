import type { AnswerRecord, AttemptRow, OrderItem, QuestionRow, QuizRow, SectionRow, User } from '../types'
import { logActivity, normalizeShortAnswer, nowIso, safeJson, shuffle } from './util'

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export type QuizQuestionJoined = QuestionRow & { qq_id: number; section_id: number | null; position: number; marks: number | null }

export async function getQuiz(db: D1Database, id: number): Promise<QuizRow | null> {
  return (await db.prepare('SELECT * FROM quizzes WHERE id = ?').bind(id).first<QuizRow>()) ?? null
}

export async function getSections(db: D1Database, quizId: number): Promise<SectionRow[]> {
  const r = await db.prepare('SELECT * FROM quiz_sections WHERE quiz_id = ? ORDER BY position, id').bind(quizId).all<SectionRow>()
  return r.results
}

export async function getQuizQuestions(db: D1Database, quizId: number): Promise<QuizQuestionJoined[]> {
  const r = await db
    .prepare(
      `SELECT q.*, qq.id AS qq_id, qq.section_id, qq.position, qq.marks
         FROM quiz_questions qq JOIN questions q ON q.id = qq.question_id
        WHERE qq.quiz_id = ? ORDER BY qq.position, qq.id`
    )
    .bind(quizId)
    .all<QuizQuestionJoined>()
  return r.results
}

/* ------------------------------------------------------------------ */
/* Access control (server-side; play-access rules)   */
/* ------------------------------------------------------------------ */

export type AccessResult = {
  allowed: boolean
  reason?: string
  code?: string
  attempts_used: number
  attempts_left: number | null
  in_progress_attempt_id: number | null
}

export async function checkAccess(db: D1Database, quiz: QuizRow, user: User): Promise<AccessResult> {
  const counts = await db
    .prepare(
      `SELECT SUM(CASE WHEN status != 'in_progress' THEN 1 ELSE 0 END) AS used,
              MAX(CASE WHEN status = 'in_progress' THEN id END) AS open_id
         FROM attempts WHERE quiz_id = ? AND user_id = ?`
    )
    .bind(quiz.id, user.id)
    .first<{ used: number | null; open_id: number | null }>()
  const used = counts?.used ?? 0
  const left = quiz.attempt_limit > 0 ? Math.max(0, quiz.attempt_limit - used) : null
  const base = { attempts_used: used, attempts_left: left, in_progress_attempt_id: counts?.open_id ?? null }
  const deny = (code: string, reason: string): AccessResult => ({ allowed: false, code, reason, ...base })

  if (quiz.status !== 'published') return deny('not_published', 'This quiz is not currently available.')
  const now = Date.now()
  if (quiz.start_at && new Date(quiz.start_at).getTime() > now) return deny('not_started', `This quiz opens on ${fmtDate(quiz.start_at)}.`)
  if (quiz.end_at && new Date(quiz.end_at).getTime() < now) return deny('closed', `This quiz closed on ${fmtDate(quiz.end_at)}.`)

  if (quiz.premium_only && !user.is_premium) return deny('premium_required', 'This quiz is available to premium members only.')

  if (quiz.access_type === 'restricted') {
    const assigned = await db
      .prepare(
        `SELECT 1 FROM quiz_assignments a
          WHERE a.quiz_id = ? AND (a.user_id = ? OR a.batch_id IN (SELECT batch_id FROM batch_members WHERE user_id = ?))
          LIMIT 1`
      )
      .bind(quiz.id, user.id, user.id)
      .first()
    if (!assigned) return deny('not_assigned', 'This quiz is restricted to selected students or batches.')
  }

  if (quiz.is_paid) {
    const bought = await db
      .prepare("SELECT 1 FROM quiz_purchases WHERE quiz_id = ? AND user_id = ? AND status = 'granted'")
      .bind(quiz.id, user.id)
      .first()
    if (!bought) return deny('payment_required', 'This is a paid quiz. Access has not been granted to your account yet.')
  }

  if (base.in_progress_attempt_id) return { allowed: true, ...base }
  if (left !== null && left <= 0) return deny('attempt_limit', 'You have used all allowed attempts for this quiz.')
  return { allowed: true, ...base }
}

function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return s
  }
}

/* ------------------------------------------------------------------ */
/* Attempt lifecycle                                                   */
/* ------------------------------------------------------------------ */

export async function startAttempt(db: D1Database, quiz: QuizRow, user: User, mode: 'exam' | 'practice'): Promise<AttemptRow> {
  const sections = await getSections(db, quiz.id)
  const questions = await getQuizQuestions(db, quiz.id)
  if (!questions.length) throw new Error('This quiz has no questions yet.')

  // Group by section (sectional quizzes keep sections contiguous; shuffle within)
  const sectionIds: Array<number | null> = quiz.quiz_format === 'sectional' ? sections.map((s) => s.id) : [null]
  if (quiz.quiz_format === 'sectional' && questions.some((q) => !q.section_id || !sectionIds.includes(q.section_id))) sectionIds.push(null)

  let order: OrderItem[] = []
  for (const sid of sectionIds) {
    let group = quiz.quiz_format === 'sectional' ? questions.filter((q) => (q.section_id ?? null) === sid || (sid === null && !sectionIds.includes(q.section_id))) : questions
    if (quiz.shuffle_questions) group = shuffle(group)
    for (const q of group) {
      let optionOrder: number[] | null = null
      if (q.type === 'mcq' && quiz.shuffle_options) {
        const opts = safeJson<string[]>(q.options_json, [])
        optionOrder = shuffle(opts.map((_, i) => i))
      }
      order.push({ qq_id: q.qq_id, question_id: q.id, section_id: quiz.quiz_format === 'sectional' ? q.section_id : null, option_order: optionOrder })
    }
  }

  const started = new Date()
  let deadline: string | null = null
  if (quiz.quiz_format === 'sectional') {
    const total = sections.reduce((a, s) => a + (s.duration_minutes ?? 0), 0)
    if (total > 0) deadline = new Date(started.getTime() + total * 60_000).toISOString()
  } else if (quiz.duration_minutes) {
    deadline = new Date(started.getTime() + quiz.duration_minutes * 60_000).toISOString()
  }

  const res = await db
    .prepare(
      `INSERT INTO attempts (quiz_id, user_id, mode, status, order_json, answers_json, current_section, section_started_at, started_at, deadline_at)
       VALUES (?, ?, ?, 'in_progress', ?, '{}', 0, ?, ?, ?)`
    )
    .bind(quiz.id, user.id, mode, JSON.stringify(order), started.toISOString(), started.toISOString(), deadline)
    .run()
  const id = res.meta.last_row_id as number
  await logActivity(db, user.id, 'attempt_started', `${user.name} started "${quiz.title}" (${mode} mode)`, 'attempt', id)
  return (await db.prepare('SELECT * FROM attempts WHERE id = ?').bind(id).first<AttemptRow>())!
}

export async function getAttempt(db: D1Database, id: number): Promise<AttemptRow | null> {
  return (await db.prepare('SELECT * FROM attempts WHERE id = ?').bind(id).first<AttemptRow>()) ?? null
}

/** Public view of a question for the player: no correct answer, no explanation. */
export function publicQuestion(q: QuestionRow, item: OrderItem, idx: number) {
  const opts = safeJson<string[]>(q.options_json, [])
  const displayed = item.option_order ? item.option_order.map((o) => opts[o]) : opts
  return {
    index: idx,
    question_id: q.id,
    section_id: item.section_id,
    type: q.type,
    text: q.text,
    options: displayed,
    multi: q.type === 'mcq' ? safeJson<number[]>(q.correct_json, []).length > 1 : false
  }
}

export type SectionState = {
  id: number
  title: string
  position: number
  duration_minutes: number | null
  question_indexes: number[]
  locked: boolean
  current: boolean
  deadline_at: string | null
}

export function buildSectionStates(attempt: AttemptRow, quiz: QuizRow, sections: SectionRow[], order: OrderItem[]): SectionState[] {
  if (quiz.quiz_format !== 'sectional') return []
  const states: SectionState[] = []
  sections.forEach((s, i) => {
    const idxs = order.map((o, idx) => (o.section_id === s.id ? idx : -1)).filter((x) => x >= 0)
    const current = i === attempt.current_section
    let deadline: string | null = null
    if (current && s.duration_minutes && attempt.section_started_at) {
      deadline = new Date(new Date(attempt.section_started_at).getTime() + s.duration_minutes * 60_000).toISOString()
      if (attempt.deadline_at && new Date(attempt.deadline_at) < new Date(deadline)) deadline = attempt.deadline_at
    }
    states.push({ id: s.id, title: s.title, position: i, duration_minutes: s.duration_minutes, question_indexes: idxs, locked: i < attempt.current_section, current, deadline_at: deadline })
  })
  return states
}

export function isAttemptExpired(attempt: AttemptRow): boolean {
  return Boolean(attempt.deadline_at && new Date(attempt.deadline_at).getTime() + 5_000 < Date.now())
}

/** Determine the mark values for a question in a quiz (section overrides quiz defaults, per-question override wins). */
function marksFor(q: QuizQuestionJoined | undefined, quiz: QuizRow, section: SectionRow | undefined) {
  const positive = q?.marks ?? section?.marks_per_question ?? quiz.marks_per_question
  const negative = section?.negative_marks ?? quiz.negative_marks
  return { positive: Number(positive) || 0, negative: Number(negative) || 0 }
}

/** Evaluate an answer against the question's key. */
export function evaluate(q: QuestionRow, item: OrderItem, ans: AnswerRecord): { answered: boolean; correct: boolean; correctDisplayed: number[] | string[] } {
  if (q.type === 'short_answer') {
    const accepted = safeJson<string[]>(q.correct_json, []).map(normalizeShortAnswer)
    const given = normalizeShortAnswer(ans.text ?? '')
    return { answered: given.length > 0, correct: given.length > 0 && accepted.includes(given), correctDisplayed: safeJson<string[]>(q.correct_json, []) }
  }
  const correctOriginal = safeJson<number[]>(q.correct_json, [])
  const correctDisplayed = item.option_order ? correctOriginal.map((c) => item.option_order!.indexOf(c)) : correctOriginal
  const selected = (ans.selected ?? []).slice().sort((a, b) => a - b)
  const answered = selected.length > 0
  const expected = correctDisplayed.slice().sort((a, b) => a - b)
  const correct = answered && selected.length === expected.length && selected.every((v, i) => v === expected[i])
  return { answered, correct, correctDisplayed }
}

export async function scoreAttempt(db: D1Database, attempt: AttemptRow, quiz: QuizRow, status: 'submitted' | 'expired' = 'submitted') {
  const order = safeJson<OrderItem[]>(attempt.order_json, [])
  const answers = safeJson<Record<string, AnswerRecord>>(attempt.answers_json, {})
  const questions = await getQuizQuestions(db, quiz.id)
  const sections = await getSections(db, quiz.id)
  const qMap = new Map(questions.map((q) => [q.id, q]))
  const sMap = new Map(sections.map((s) => [s.id, s]))

  let score = 0
  let max = 0
  let correctCount = 0
  let wrongCount = 0
  let unanswered = 0
  const sectionScores: Record<string, { title: string; score: number; max: number; correct: number; wrong: number; unanswered: number; total: number }> = {}
  const statStmts: D1PreparedStatement[] = []

  for (const item of order) {
    const q = qMap.get(item.question_id)
    if (!q) continue
    const section = item.section_id ? sMap.get(item.section_id) : undefined
    const { positive, negative } = marksFor(q, quiz, section)
    max += positive
    const ans = answers[String(q.id)] ?? {}
    const ev = evaluate(q, item, ans)
    let delta = 0
    if (!ev.answered) unanswered++
    else if (ev.correct) {
      correctCount++
      delta = positive
    } else {
      wrongCount++
      delta = -negative
    }
    score += delta
    answers[String(q.id)] = { ...ans, correct: ev.answered ? ev.correct : undefined, delta }

    const key = section ? String(section.id) : 'general'
    if (!sectionScores[key]) sectionScores[key] = { title: section?.title ?? 'General', score: 0, max: 0, correct: 0, wrong: 0, unanswered: 0, total: 0 }
    const ss = sectionScores[key]
    ss.total++
    ss.max += positive
    ss.score += delta
    if (!ev.answered) ss.unanswered++
    else if (ev.correct) ss.correct++
    else ss.wrong++

    statStmts.push(
      db
        .prepare(
          `INSERT INTO question_stats (question_id, quiz_id, attempts, correct, wrong, skipped, total_time_ms) VALUES (?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT(question_id, quiz_id) DO UPDATE SET attempts = attempts + 1, correct = correct + excluded.correct,
             wrong = wrong + excluded.wrong, skipped = skipped + excluded.skipped, total_time_ms = total_time_ms + excluded.total_time_ms`
        )
        .bind(q.id, quiz.id, ev.answered && ev.correct ? 1 : 0, ev.answered && !ev.correct ? 1 : 0, ev.answered ? 0 : 1, Math.round(ans.time_ms ?? 0))
    )
  }

  score = Math.round(score * 100) / 100
  const percent = max > 0 ? Math.round((Math.max(score, 0) / max) * 10000) / 100 : 0
  const passed = percent >= quiz.pass_mark ? 1 : 0
  const submittedAt = new Date()
  const timeTaken = Math.max(0, Math.round((submittedAt.getTime() - new Date(attempt.started_at).getTime()) / 1000))

  await db
    .prepare(
      `UPDATE attempts SET status = ?, answers_json = ?, submitted_at = ?, score = ?, max_score = ?, percent = ?, correct_count = ?, wrong_count = ?,
              unanswered_count = ?, passed = ?, time_taken_sec = ?, section_scores_json = ? WHERE id = ?`
    )
    .bind(status, JSON.stringify(answers), submittedAt.toISOString(), score, max, percent, correctCount, wrongCount, unanswered, passed, timeTaken, JSON.stringify(sectionScores), attempt.id)
    .run()
  if (statStmts.length) await db.batch(statStmts)

  const student = await db.prepare('SELECT name FROM users WHERE id = ?').bind(attempt.user_id).first<{ name: string }>()
  await logActivity(db, attempt.user_id, 'attempt_submitted', `${student?.name ?? 'A student'} scored ${percent}% on "${quiz.title}"`, 'attempt', attempt.id)

  return { score, max, percent, passed, correctCount, wrongCount, unanswered, timeTaken, sectionScores }
}

/** Build the full review payload. `reveal` controls whether keys & explanations are included. */
export async function buildReview(db: D1Database, attempt: AttemptRow, quiz: QuizRow, reveal: boolean) {
  const order = safeJson<OrderItem[]>(attempt.order_json, [])
  const answers = safeJson<Record<string, AnswerRecord>>(attempt.answers_json, {})
  const questions = await getQuizQuestions(db, quiz.id)
  const sections = await getSections(db, quiz.id)
  const qMap = new Map(questions.map((q) => [q.id, q]))
  const sMap = new Map(sections.map((s) => [s.id, s]))

  const items = order
    .map((item, idx) => {
      const q = qMap.get(item.question_id)
      if (!q) return null
      const ans = answers[String(q.id)] ?? {}
      const ev = evaluate(q, item, ans)
      const pub = publicQuestion(q, item, idx)
      const section = item.section_id ? sMap.get(item.section_id) : undefined
      const { positive, negative } = marksFor(q, quiz, section)
      return {
        ...pub,
        section_title: section?.title ?? null,
        marks: positive,
        negative_marks: negative,
        selected: ans.selected ?? [],
        text_answer: ans.text ?? '',
        flagged: Boolean(ans.flagged),
        answered: ev.answered,
        correct: ev.answered ? ev.correct : null,
        delta: ans.delta ?? 0,
        time_ms: ans.time_ms ?? 0,
        ...(reveal ? { correct_options: ev.correctDisplayed, explanation: q.explanation } : {})
      }
    })
    .filter(Boolean)

  return {
    attempt: {
      id: attempt.id,
      mode: attempt.mode,
      status: attempt.status,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      score: attempt.score,
      max_score: attempt.max_score,
      percent: attempt.percent,
      passed: attempt.passed,
      correct_count: attempt.correct_count,
      wrong_count: attempt.wrong_count,
      unanswered_count: attempt.unanswered_count,
      time_taken_sec: attempt.time_taken_sec,
      section_scores: safeJson<Record<string, unknown>>(attempt.section_scores_json, {})
    },
    quiz: { id: quiz.id, title: quiz.title, subject: quiz.subject, topic: quiz.topic, pass_mark: quiz.pass_mark, show_answers: quiz.show_answers, quiz_format: quiz.quiz_format },
    reveal,
    questions: items
  }
}

export function attemptSummary(a: AttemptRow) {
  return {
    id: a.id,
    quiz_id: a.quiz_id,
    user_id: a.user_id,
    mode: a.mode,
    status: a.status,
    started_at: a.started_at,
    submitted_at: a.submitted_at,
    score: a.score,
    max_score: a.max_score,
    percent: a.percent,
    passed: a.passed,
    correct_count: a.correct_count,
    wrong_count: a.wrong_count,
    unanswered_count: a.unanswered_count,
    time_taken_sec: a.time_taken_sec
  }
}

export { nowIso }
