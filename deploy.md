# Deploy checklist: INSPIRE Academy Quiz Platform

Date: 2026-10-26  Commit: none (not a git repo yet)  Go from user: **not yet**

**Verdict: not ready to go live yet.** Remaining blockers: the privacy and terms text must be reviewed by a legal adviser, and the production build and server routes have not been run (they need `npm install`, which could not run in the sandbox).

## Preflight (all must pass)

- [ ] e2e suite green: **not run for the server app** (no suite in the repo). The phone previews (admin, student, combined) passed an offline Playwright click-through: sign-in, publish, take exam and practice, submit, review, results, reports, announcements, new student account.
- [x] no open S1 or S2 bugs: none known. The server routes have not been exercised end to end.
- [ ] parity: **n/a** (no replica/features.csv; the project was not built from a recon matrix)
- [x] rebrand sweep clean: `sweep.py` exit 0 on the project and on the three phone apps (names Qzio, Quizbot, devgaganin; domain qzio.in; violet and indigo colours). Credits live in `replica/credits.md`. The Quizbot reference project is MIT licensed; its notice is kept in `replica/licenses/` (no source was copied).
- [x] store listing: n/a (web app, no store submission)
- [ ] production build passes: **not run** (`npm install && npm run build`)
- [x] SQL check: `npm run test:sql` 53 ok, 0 bad. The demo seed and the first-admin seed ran against the real schema in SQLite.
- [~] privacy policy and terms: **draft pages added** at `/privacy` and `/terms`, listing Cloudflare, Sentry and OpenAI. They show a "draft, not reviewed" box until you fill the bracketed items, have a legal adviser check them, and set `LEGAL_REVIEWED=true`. Sign-up now asks for agreement to both.
- [x] account deletion works: students delete their own account from Account (password required). Name, email and sign-in are removed; results are kept without identifying details (anonymised; switching to hard delete is a small change). Tested against the real schema.
- [~] favicon, titles, OG: INSPIRE logo, favicon, app icons, installable-app manifest, title, description and social-share image added. The app sends no emails.

## Gaps found beyond the checklist

- Password reset is admin-issued (no email is sent): Students page, Reset password, send the one-time link (24 hours, single use, signs the student out everywhere). Tested against the real schema.
- Minimum password length raised from 6 to 8.
- One-time codes need your own email/SMS delivery (`OTP_WEBHOOK_URL`); until it is set, only password sign-in works on a live site. Migration `0003_otp.sql` adds phone numbers and the code table.
- Migrations are a manual step (`npm run db:migrate:remote`), not part of the deploy.

## Production

- [ ] separate production database: create with `wrangler d1 create webapp-production` (steps in docs/DEPLOY.md). Backups: check D1's restore options in the dashboard.
- [ ] env vars (names): `ADMIN_EMAIL`, `ADMIN_PASSWORD` (8+ characters), `OPERATOR_NAME`, `CONTACT_EMAIL`, `LEGAL_REVIEWED` (set to true only after the legal pages are reviewed), `SENTRY_DSN`, `OPENAI_API_KEY` (optional, with `OPENAI_BASE_URL`, `OPENAI_MODEL`), `TELEGRAM_BOT_TOKEN` (not used yet). Never set `DEMO_MODE` on a live site. Template: `.dev.vars.example`.
- [x] Stripe: n/a, payments are disabled by design
- [x] OAuth: n/a, email and password sign-in only
- [x] email sending domain: n/a, the app sends no email

## Domain

- [ ] default address is `https://<project>.pages.dev` (HTTPS automatic). A custom domain is optional: you buy it, then Cloudflare Pages, Custom domains, shows the exact DNS records to add. SPF, DKIM and DMARC are only needed once the app sends email.

## Watch

- [ ] error tracking: wired in code; needs `SENTRY_DSN` (docs/LOGS-KIT.md)
- [ ] uptime checks: point any free monitor at `/api/health` (added) and at the sign-in page
- [x] analytics: none, and only an essential session cookie is used
- [ ] core flow done on the live site, desktop and phone: after deploy (the 5-minute test in docs/LOGS-KIT.md)

## First week

Watch Sentry for new issues, read the login-failed and access-denied lines, and check that attempts are submitted (not auto-submitted) at a normal rate.
