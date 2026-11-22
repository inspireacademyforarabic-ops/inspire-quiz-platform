-- INSPIRE Academy Quiz Platform – initial schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','creator','student')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_premium INTEGER NOT NULL DEFAULT 0,
  telegram_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batch_members (
  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, user_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('mcq','true_false','short_answer')),
  text TEXT NOT NULL,
  options_json TEXT,              -- JSON array of option strings (mcq / true_false)
  correct_json TEXT NOT NULL,     -- JSON: array of option indexes (mcq/tf) or array of accepted strings (short)
  explanation TEXT,
  subject TEXT,
  topic TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  subject TEXT,
  topic TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  quiz_format TEXT NOT NULL DEFAULT 'standard' CHECK (quiz_format IN ('standard','sectional')),
  mode TEXT NOT NULL DEFAULT 'exam' CHECK (mode IN ('exam','practice','both')),
  duration_minutes INTEGER,               -- NULL = untimed
  start_at TEXT,
  end_at TEXT,
  attempt_limit INTEGER NOT NULL DEFAULT 1,  -- 0 = unlimited
  pass_mark REAL NOT NULL DEFAULT 40,        -- percent
  marks_per_question REAL NOT NULL DEFAULT 1,
  negative_marks REAL NOT NULL DEFAULT 0,
  shuffle_questions INTEGER NOT NULL DEFAULT 0,
  shuffle_options INTEGER NOT NULL DEFAULT 0,
  show_answers INTEGER NOT NULL DEFAULT 1,   -- reveal correct answers + explanations after submit (exam)
  access_type TEXT NOT NULL DEFAULT 'free' CHECK (access_type IN ('free','restricted')),
  is_paid INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  premium_only INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quizzes_status ON quizzes(status);

CREATE TABLE IF NOT EXISTS quiz_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER,
  marks_per_question REAL,
  negative_marks REAL
);
CREATE INDEX IF NOT EXISTS idx_sections_quiz ON quiz_sections(quiz_id);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES quiz_sections(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  marks REAL,
  UNIQUE (quiz_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_qq_quiz ON quiz_questions(quiz_id, position);

CREATE TABLE IF NOT EXISTS quiz_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assign_quiz ON quiz_assignments(quiz_id);

CREATE TABLE IF NOT EXISTS quiz_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'granted',
  granted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (quiz_id, user_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('exam','practice')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','expired')),
  order_json TEXT NOT NULL,            -- JSON: [{qq_id, question_id, section_id, option_order:[...]}]
  answers_json TEXT NOT NULL DEFAULT '{}', -- JSON: { question_id: {selected:[...]|text, flagged, answered_at, time_ms, correct?, delta?} }
  current_section INTEGER NOT NULL DEFAULT 0,
  section_started_at TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  deadline_at TEXT,
  submitted_at TEXT,
  score REAL,
  max_score REAL,
  percent REAL,
  correct_count INTEGER,
  wrong_count INTEGER,
  unanswered_count INTEGER,
  passed INTEGER,
  time_taken_sec INTEGER,
  section_scores_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON attempts(quiz_id, status);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, status);

CREATE TABLE IF NOT EXISTS question_stats (
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  total_time_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, quiz_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
