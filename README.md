# INSPIRE Academy Quiz Platform

Hono + Cloudflare Pages + D1. Creator/Admin dashboard and Student portal in one app.

## Run locally
```
npm install
npm run db:migrate:local      # creates tables in the local D1 database
npm run build
npx wrangler pages dev dist --d1=webapp-production --local --port 3000
```
Open http://localhost:3000. Demo data is created on the first request to an empty database.

Full deployment steps (computer or phone-only): `docs/DEPLOY.md`.

Demo accounts exist only on localhost (or when `DEMO_MODE=true`). On a live site set the `ADMIN_EMAIL` and `ADMIN_PASSWORD` secrets and the first admin is created from them. Demo accounts (password `Inspire@123`): `admin@inspire.academy` (creator/admin), `student1@inspire.academy` … `student5@inspire.academy`.
Student 1–3 are in the "UGC NET Arabic 2026" batch, which is assigned the restricted practice quiz; students 4–5 cannot see it.

## Deploy
Create a D1 database, put its id in `wrangler.jsonc`, run `npm run db:migrate:remote`, then `npm run deploy`.

## Needs your configuration
- AI question generation: `wrangler pages secret put OPENAI_API_KEY` (optional `OPENAI_BASE_URL`, `OPENAI_MODEL`).
- Telegram: `TELEGRAM_BOT_TOKEN` is only detected; the bot is not built yet.
- Payments: disabled. Paid quizzes stay locked until a provider is wired and access is granted.
- Change the demo password and delete demo users before real use.

## Accounts, privacy and password reset
Students sign up themselves (agreeing to `/terms` and `/privacy`), change their password, and delete their account from the Account button. An admin issues a one-time reset link from Students → Reset password (no email needed). The legal pages are drafts until `LEGAL_REVIEWED=true`.

## One-time codes and phone sign-in
Students can sign in with email or phone number, with a password or a 6-digit one-time code, and reset a forgotten password with a code (5 minutes, 5 tries, single use, 30-second resend, 3 per 15 minutes). Codes are stored only as salted hashes. **Delivery needs your own email/SMS service:** set `OTP_WEBHOOK_URL` (and `OTP_WEBHOOK_TOKEN`); the app POSTs `{to, channel, code, purpose, app}` to it. Without it, codes are returned in the response only on localhost or when `DEMO_MODE=true`, so a live site cannot send codes until you configure delivery. Apply `migrations/0003_otp.sql`.


## Student details and the live Android app
Sign-up collects: name, mobile number, email, exam, state, city or district, qualification (no date of birth or ID numbers). Students can edit them under Account; staff see them on the Students page and can export a CSV. Apply `migrations/0004_student_details.sql`. To publish from a phone with no computer, see `docs/DEPLOY-GITHUB.md` (a GitHub workflow does the Cloudflare setup). The live Android app (`inspire-live.apk`) opens your deployed address; students sign in with real accounts.

## Logging and error tracking
See `docs/LOGS-KIT.md` (Sentry + structured logs, requestId/userId on every line, secrets redacted, the 5-minute test). Set `SENTRY_DSN` to turn it on.

## Server-side rules
Role checks (`requireRole`) guard every `/api/staff/*` and `/api/student/*` route. `checkAccess` (status, dates, assignment, premium, payment, attempt limit) runs on start, answer and submit. Correct answers and explanations are never sent while an exam attempt is in progress; in practice mode they are returned only for questions already answered, and practice answers are final.
