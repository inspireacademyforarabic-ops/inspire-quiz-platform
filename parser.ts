/**
 * Question text parser – a quiz-bot-style paste format,
 * `parse_question_block` (creator_bot/parsing.py), extended to understand
 * a few more common formats so pasted text / PDF text / CSV / JSON all
 * end up as the same draft-question shape for the review step.
 *
 * Supported text formats (blocks separated by blank lines):
 *   Question text
 *   A) option one
 *   B) option two ✅          <- ✅ marks the correct option (marks the correct option)
 *   Ex: explanation            <- optional
 *
 *   Q1. Question text
 *   a. option / (a) option / 1) option / - option / * option
 *   Answer: B                  <- "Answer:" / "Ans:" / "Correct:" line (letter, number or text)
 *   Explanation: ...
 *
 * True/false questions are detected when the options are exactly True / False.
 * Short-answer questions are created when there are no options but an Answer line.
 */

export type DraftQuestion = {
  type: 'mcq' | 'true_false' | 'short_answer'
  text: string
  options: string[]
  correct: number[] | string[]
  explanation: string | null
  subject?: string | null
  topic?: string | null
  difficulty?: 'easy' | 'medium' | 'hard'
}

const OPTION_RE = /^\s*(?:\(?([A-Ha-h]|[1-8])[\).:\]-]|[-*•])\s+(.*)$/
const QNUM_RE = /^\s*(?:Q(?:uestion)?\s*)?\d+\s*[\).:\-]\s*/i
const ANSWER_RE = /^\s*(?:answer|ans|correct(?:\s+answer)?|key)\s*[:\-]\s*(.+)$/i
const EXPL_RE = /^\s*(?:ex|exp|explanation|solution|sol)\s*[:\-]\s*(.*)$/i

function cleanMarkdown(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
}

function letterToIndex(s: string): number | null {
  const t = s.trim().toUpperCase()
  if (/^[A-H]$/.test(t)) return t.charCodeAt(0) - 65
  if (/^[1-8]$/.test(t)) return parseInt(t, 10) - 1
  return null
}

function parseBlock(block: string): DraftQuestion | null {
  const lines = cleanMarkdown(block).split('\n')
  const qLines: string[] = []
  const options: string[] = []
  const correct: number[] = []
  let answerLine: string | null = null
  let explanation: string | null = null
  let inOptions = false

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    const ex = line.match(EXPL_RE)
    if (ex) {
      explanation = ex[1].trim() || null
      continue
    }
    const ans = line.match(ANSWER_RE)
    if (ans) {
      answerLine = ans[1].trim()
      continue
    }
    const opt = line.match(OPTION_RE)
    if (opt) {
      inOptions = true
      let text = opt[2].trim()
      if (text.includes('✅') || /\(correct\)\s*$/i.test(text) || /^\*/.test(text)) {
        correct.push(options.length)
        text = text.replace('✅', '').replace(/\(correct\)\s*$/i, '').replace(/^\*/, '').trim()
      }
      options.push(text)
      continue
    }
    if (!inOptions) qLines.push(line.trim())
    else if (options.length) options[options.length - 1] += ' ' + line.trim()
  }

  const text = qLines.join('\n').replace(QNUM_RE, '').trim()
  if (!text) return null

  // Resolve "Answer:" line
  if (answerLine && options.length >= 2 && correct.length === 0) {
    const parts = answerLine.split(/[,&\/ ]+/).filter(Boolean)
    for (const p of parts) {
      const idx = letterToIndex(p)
      if (idx !== null && idx < options.length) correct.push(idx)
    }
    if (correct.length === 0) {
      const idx = options.findIndex((o) => o.toLowerCase() === answerLine!.toLowerCase())
      if (idx >= 0) correct.push(idx)
    }
  }

  if (options.length >= 2) {
    if (correct.length === 0) return null
    const lower = options.map((o) => o.toLowerCase())
    const isTF = options.length === 2 && lower.includes('true') && lower.includes('false')
    if (isTF) {
      const tfOptions = ['True', 'False']
      const c = correct.map((i) => (lower[i] === 'true' ? 0 : 1))
      return { type: 'true_false', text, options: tfOptions, correct: [c[0]], explanation }
    }
    return { type: 'mcq', text, options, correct: Array.from(new Set(correct)).sort(), explanation }
  }

  // No options → short answer if we have an answer line
  if (answerLine) {
    const accepted = answerLine.split(/\s*\|\s*|\s*;\s*/).map((s) => s.trim()).filter(Boolean)
    return { type: 'short_answer', text, options: [], correct: accepted, explanation }
  }
  return null
}

export function parseQuestionText(input: string): { questions: DraftQuestion[]; skipped: number } {
  const normalized = input.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  // Split into blocks: blank lines, or a new "Q12." / "12." numbered line following options
  const blocks: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.some((l) => l.trim())) blocks.push(current.join('\n'))
    current = []
  }
  for (const line of normalized.split('\n')) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (QNUM_RE.test(line) && current.some((l) => OPTION_RE.test(l))) flush()
    current.push(line)
  }
  flush()

  const questions: DraftQuestion[] = []
  let skipped = 0
  for (const b of blocks) {
    const q = parseBlock(b)
    if (q) questions.push(q)
    else skipped++
  }
  return { questions, skipped }
}

/** Parse CSV: question,optionA,optionB,optionC,optionD,answer,explanation,subject,topic,difficulty */
export function parseCsv(input: string): { questions: DraftQuestion[]; skipped: number } {
  const rows = csvRows(input)
  if (!rows.length) return { questions: [], skipped: 0 }
  let header = rows[0].map((h) => h.trim().toLowerCase())
  let start = 1
  const looksLikeHeader = header.some((h) => /question|answer|option/.test(h))
  if (!looksLikeHeader) {
    header = ['question', 'a', 'b', 'c', 'd', 'answer', 'explanation', 'subject', 'topic', 'difficulty']
    start = 0
  }
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h))
  const qi = idx(['question', 'text', 'q'])
  const ai = idx(['answer', 'correct', 'key'])
  const ei = idx(['explanation', 'ex', 'solution'])
  const si = idx(['subject'])
  const ti = idx(['topic'])
  const di = idx(['difficulty', 'level'])
  const ty = idx(['type'])
  const optIdx = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^(option\s*)?[a-h1-8]$/.test(h) || /^option/.test(h))
    .map(({ i }) => i)

  const questions: DraftQuestion[] = []
  let skipped = 0
  for (let r = start; r < rows.length; r++) {
    const row = rows[r]
    const text = (row[qi] ?? '').trim()
    if (!text) {
      skipped++
      continue
    }
    const options = optIdx.map((i) => (row[i] ?? '').trim()).filter(Boolean)
    const answer = (row[ai] ?? '').trim()
    const explanation = ei >= 0 ? (row[ei] ?? '').trim() || null : null
    const subject = si >= 0 ? (row[si] ?? '').trim() || null : null
    const topic = ti >= 0 ? (row[ti] ?? '').trim() || null : null
    const dRaw = di >= 0 ? (row[di] ?? '').trim().toLowerCase() : ''
    const difficulty = (['easy', 'medium', 'hard'].includes(dRaw) ? dRaw : 'medium') as DraftQuestion['difficulty']
    const typeRaw = ty >= 0 ? (row[ty] ?? '').trim().toLowerCase() : ''

    if (options.length >= 2) {
      const correct: number[] = []
      for (const p of answer.split(/[,&\/ ]+/).filter(Boolean)) {
        const li = letterToIndex(p)
        if (li !== null && li < options.length) correct.push(li)
      }
      if (!correct.length) {
        const fi = options.findIndex((o) => o.toLowerCase() === answer.toLowerCase())
        if (fi >= 0) correct.push(fi)
      }
      if (!correct.length) {
        skipped++
        continue
      }
      const lower = options.map((o) => o.toLowerCase())
      const isTF = options.length === 2 && lower.includes('true') && lower.includes('false')
      questions.push({
        type: isTF ? 'true_false' : 'mcq',
        text,
        options: isTF ? ['True', 'False'] : options,
        correct: isTF ? [lower[correct[0]] === 'true' ? 0 : 1] : correct,
        explanation,
        subject,
        topic,
        difficulty
      })
    } else if (typeRaw === 'true_false' || /^(true|false)$/i.test(answer)) {
      questions.push({
        type: 'true_false',
        text,
        options: ['True', 'False'],
        correct: [/^true$/i.test(answer) ? 0 : 1],
        explanation,
        subject,
        topic,
        difficulty
      })
    } else if (answer) {
      questions.push({
        type: 'short_answer',
        text,
        options: [],
        correct: answer.split(/\s*\|\s*/).filter(Boolean),
        explanation,
        subject,
        topic,
        difficulty
      })
    } else skipped++
  }
  return { questions, skipped }
}

function csvRows(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  const s = input.replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim()))
}

/** Parse a JSON array of questions in a forgiving shape. */
export function parseJsonQuestions(input: unknown): { questions: DraftQuestion[]; skipped: number } {
  let data: any = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch {
      return { questions: [], skipped: 0 }
    }
  }
  const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : []
  const questions: DraftQuestion[] = []
  let skipped = 0
  for (const q of arr) {
    const d = normalizeDraft(q)
    if (d) questions.push(d)
    else skipped++
  }
  return { questions, skipped }
}

/** Normalize an arbitrary object (from JSON import or AI output) into a DraftQuestion. */
export function normalizeDraft(q: any): DraftQuestion | null {
  if (!q || typeof q !== 'object') return null
  const text = String(q.text ?? q.question ?? '').trim()
  if (!text) return null
  const explanation = q.explanation ? String(q.explanation).trim() : null
  const dRaw = String(q.difficulty ?? 'medium').toLowerCase()
  const difficulty = (['easy', 'medium', 'hard'].includes(dRaw) ? dRaw : 'medium') as DraftQuestion['difficulty']
  const subject = q.subject ? String(q.subject) : null
  const topic = q.topic ? String(q.topic) : null
  let type = String(q.type ?? '').toLowerCase().replace(/[\s-]/g, '_')
  if (type === 'multiple_choice' || type === 'multiplechoice' || type === 'choice') type = 'mcq'
  if (type === 'tf' || type === 'truefalse' || type === 'boolean') type = 'true_false'
  if (type === 'short' || type === 'text' || type === 'fill_in_the_blank' || type === 'fill_blank') type = 'short_answer'

  let options: string[] = Array.isArray(q.options) ? q.options.map((o: any) => String(o?.text ?? o).trim()).filter(Boolean) : []
  const rawCorrect = q.correct ?? q.correct_option_id ?? q.correct_index ?? q.answer ?? q.correct_answer ?? q.correctAnswer

  if (!type) {
    if (options.length >= 2) {
      const lower = options.map((o) => o.toLowerCase())
      type = options.length === 2 && lower.includes('true') && lower.includes('false') ? 'true_false' : 'mcq'
    } else if (typeof rawCorrect === 'boolean' || /^(true|false)$/i.test(String(rawCorrect ?? ''))) type = 'true_false'
    else type = 'short_answer'
  }

  if (type === 'true_false') {
    let idx: number | null = null
    if (typeof rawCorrect === 'boolean') idx = rawCorrect ? 0 : 1
    else if (typeof rawCorrect === 'number') idx = rawCorrect === 0 ? 0 : 1
    else if (/^true$/i.test(String(rawCorrect))) idx = 0
    else if (/^false$/i.test(String(rawCorrect))) idx = 1
    else if (Array.isArray(rawCorrect) && rawCorrect.length) idx = Number(rawCorrect[0]) === 0 ? 0 : 1
    if (idx === null) return null
    return { type: 'true_false', text, options: ['True', 'False'], correct: [idx], explanation, subject, topic, difficulty }
  }

  if (type === 'mcq') {
    if (options.length < 2) return null
    let correct: number[] = []
    const list = Array.isArray(rawCorrect) ? rawCorrect : [rawCorrect]
    for (const c of list) {
      if (typeof c === 'number' && c >= 0 && c < options.length) correct.push(c)
      else if (typeof c === 'string') {
        const li = letterToIndex(c)
        if (li !== null && li < options.length && c.trim().length <= 2) correct.push(li)
        else {
          const fi = options.findIndex((o) => o.toLowerCase() === c.trim().toLowerCase())
          if (fi >= 0) correct.push(fi)
        }
      }
    }
    // Support options like [{text, correct:true}]
    if (!correct.length && Array.isArray(q.options)) {
      q.options.forEach((o: any, i: number) => {
        if (o && typeof o === 'object' && (o.correct === true || o.is_correct === true)) correct.push(i)
      })
    }
    if (!correct.length) return null
    return { type: 'mcq', text, options, correct: Array.from(new Set(correct)).sort(), explanation, subject, topic, difficulty }
  }

  // short answer
  const accepted = (Array.isArray(rawCorrect) ? rawCorrect : String(rawCorrect ?? '').split('|'))
    .map((s: any) => String(s).trim())
    .filter(Boolean)
  if (!accepted.length) return null
  return { type: 'short_answer', text, options: [], correct: accepted, explanation, subject, topic, difficulty }
}

/** Light cleanup like a chat-bot "smart filter": strips [1/100] tags, @usernames and links. */
export function cleanImportedText(t: string, removeWords: string[] = []): string {
  let out = t
    .replace(/\[\s*\d+\s*\/\s*\d+\s*\]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(^|\s)@\w{3,}/g, '$1')
  for (const w of removeWords) {
    if (!w.trim()) continue
    out = out.split(w).join('')
  }
  return out.replace(/[ \t]+\n/g, '\n')
}
