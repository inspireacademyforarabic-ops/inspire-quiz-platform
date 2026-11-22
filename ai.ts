import type { Bindings } from '../types'
import { normalizeDraft, type DraftQuestion } from './parser'

export function aiConfigured(env: Bindings): boolean {
  return Boolean(env.OPENAI_API_KEY)
}

export type AiRequest = {
  topic: string
  subject?: string
  count: number
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed'
  types: Array<'mcq' | 'true_false' | 'short_answer'>
  sourceText?: string
  language?: string
}

export async function generateQuestions(env: Bindings, req: AiRequest): Promise<DraftQuestion[]> {
  if (!env.OPENAI_API_KEY) throw new Error('AI provider is not configured')
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = env.OPENAI_MODEL || 'gpt-5-mini'
  const count = Math.min(Math.max(req.count || 5, 1), 25)
  const types = req.types?.length ? req.types : ['mcq']

  const system = `You are an expert exam setter for INSPIRE Academy. Produce high-quality, unambiguous assessment questions.
Return ONLY a JSON object: {"questions":[...]}. Each question object has:
 - "type": one of ${JSON.stringify(types)}
 - "text": the question
 - "options": array of 4 strings for mcq, ["True","False"] for true_false, [] for short_answer
 - "correct": array of correct option indexes (0-based) for mcq/true_false, or array of accepted answer strings for short_answer
 - "explanation": 1-2 sentence explanation of the correct answer
 - "difficulty": "easy" | "medium" | "hard"
 - "topic": short topic tag
No markdown, no commentary.`

  const user = [
    `Subject: ${req.subject || 'General'}`,
    `Topic: ${req.topic}`,
    `Number of questions: ${count}`,
    `Difficulty: ${req.difficulty || 'mixed'}`,
    `Language: ${req.language || 'English'}`,
    req.sourceText ? `Base the questions strictly on this source material:\n"""\n${req.sourceText.slice(0, 12000)}\n"""` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' }
    })
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`AI provider error (${resp.status}): ${txt.slice(0, 300)}`)
  }
  const data: any = await resp.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    parsed = m ? JSON.parse(m[0]) : { questions: [] }
  }
  const arr: any[] = Array.isArray(parsed) ? parsed : parsed?.questions ?? []
  const out: DraftQuestion[] = []
  for (const q of arr) {
    const d = normalizeDraft(q)
    if (d) {
      d.subject = req.subject || d.subject || null
      d.topic = d.topic || req.topic
      out.push(d)
    }
  }
  return out
}
