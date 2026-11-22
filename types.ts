export type Bindings = {
  DB: D1Database
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  TELEGRAM_BOT_TOKEN?: string
  APP_URL?: string
  SENTRY_DSN?: string
  OTP_WEBHOOK_URL?: string
  OTP_WEBHOOK_TOKEN?: string
  OPERATOR_NAME?: string
  CONTACT_EMAIL?: string
  LEGAL_REVIEWED?: string
  DEMO_MODE?: string
  ADMIN_EMAIL?: string
  ADMIN_PASSWORD?: string
}

export type Role = 'admin' | 'creator' | 'student'

export type User = {
  id: number
  email: string
  name: string
  role: Role
  is_premium: number
  telegram_id: string | null
  active: number
  created_at: string
  last_login_at: string | null
  phone?: string | null
  target_exam?: string | null
  state?: string | null
  city?: string | null
  qualification?: string | null
  consent_at?: string | null
}

export type Variables = {
  requestId: string
  user: User
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }

export type QuestionType = 'mcq' | 'true_false' | 'short_answer'

export type QuestionRow = {
  id: number
  type: QuestionType
  text: string
  options_json: string | null
  correct_json: string
  explanation: string | null
  subject: string | null
  topic: string | null
  difficulty: 'easy' | 'medium' | 'hard'
  created_by: number | null
  created_at: string
  updated_at: string
}

export type QuizRow = {
  id: number
  title: string
  description: string | null
  instructions: string | null
  subject: string | null
  topic: string | null
  difficulty: string
  status: 'draft' | 'published' | 'archived'
  quiz_format: 'standard' | 'sectional'
  mode: 'exam' | 'practice' | 'both'
  duration_minutes: number | null
  start_at: string | null
  end_at: string | null
  attempt_limit: number
  pass_mark: number
  marks_per_question: number
  negative_marks: number
  shuffle_questions: number
  shuffle_options: number
  show_answers: number
  access_type: 'free' | 'restricted'
  is_paid: number
  price: number
  premium_only: number
  created_by: number | null
  created_at: string
  updated_at: string
  published_at: string | null
}

export type SectionRow = {
  id: number
  quiz_id: number
  title: string
  position: number
  duration_minutes: number | null
  marks_per_question: number | null
  negative_marks: number | null
}

export type OrderItem = {
  qq_id: number
  question_id: number
  section_id: number | null
  option_order: number[] | null // maps displayed index -> original index
}

export type AnswerRecord = {
  selected?: number[] // displayed indexes
  text?: string
  flagged?: boolean
  answered_at?: string
  time_ms?: number
  // Filled on scoring / practice feedback
  correct?: boolean
  delta?: number
}

export type AttemptRow = {
  id: number
  quiz_id: number
  user_id: number
  mode: 'exam' | 'practice'
  status: 'in_progress' | 'submitted' | 'expired'
  order_json: string
  answers_json: string
  current_section: number
  section_started_at: string | null
  started_at: string
  deadline_at: string | null
  submitted_at: string | null
  score: number | null
  max_score: number | null
  percent: number | null
  correct_count: number | null
  wrong_count: number | null
  unanswered_count: number | null
  passed: number | null
  time_taken_sec: number | null
  section_scores_json: string | null
}
