-- Student details collected at sign-up (kept small on purpose: no date of birth, no ID numbers).
ALTER TABLE users ADD COLUMN target_exam TEXT;
ALTER TABLE users ADD COLUMN state TEXT;
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN qualification TEXT;
ALTER TABLE users ADD COLUMN consent_at TEXT;
