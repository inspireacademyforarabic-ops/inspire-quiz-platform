# Put the quiz platform online (Cloudflare Pages + D1)

Result: one link that works on every phone, with real logins and shared data. Cloudflare's free plan is enough to start; see "If logins fail" below.
Dashboard labels move around, so if a name differs slightly, look for the closest one.

## What you need
- A GitHub account and a Cloudflare account (both free).
- The project folder from `inspire-quiz-platform.zip`, extracted.

## Route A: with a computer (about 15 minutes)
1. Install Node.js 20+. In the project folder run `npm install`.
2. `npx wrangler login`, then `npx wrangler d1 create webapp-production`. Copy the `database_id` it prints into `wrangler.jsonc` (replace `local-dev-placeholder`).
3. `npm run db:migrate:remote` (creates the tables).
4. `npm run build`, then `npx wrangler pages project create inspire-quiz`, then `npx wrangler pages deploy dist --project-name inspire-quiz`.
5. In the Cloudflare dashboard → your Pages project → Settings → Variables and Secrets, add **secrets**: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (8+ characters), `CONTACT_EMAIL`, `OTP_WEBHOOK_URL` (and `OTP_WEBHOOK_TOKEN`) if you want one-time codes, and, if you use them, `SENTRY_DSN`, `OPENAI_API_KEY`. Read and finish `/privacy` and `/terms` before opening to students. Redeploy once.
6. Open the `*.pages.dev` link and sign in with the admin email and password.

## Route C: phone only, using a GitHub Codespace (no computer, no folder uploads)
A Codespace is a computer in your browser. You upload the zip once and type the commands.
1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token. Account permissions: **Cloudflare Pages: Edit**, **D1: Edit**, **Workers Scripts: Edit**, **Account Settings: Read**. Copy the token (shown once). If a command later says a permission is missing, add the one it names.
2. GitHub → github.com/codespaces → New codespace → pick the Blank template. (Codespaces has a free monthly allowance; check your usage.)
3. In the Codespace, switch your phone browser to "Desktop site". Explorer → ⋯ → Upload → choose `inspire-quiz-platform.zip`.
4. Open the Terminal and run, one line at a time:
   - `unzip inspire-quiz-platform.zip && cd genspark-*/`
   - `export CLOUDFLARE_API_TOKEN=PASTE_YOUR_TOKEN`
   - `npm install`
   - `npx wrangler d1 create webapp-production` → copy the `database_id`, open `wrangler.jsonc`, replace `local-dev-placeholder` with it, save.
   - `npm run db:migrate:remote`
   - `npm run build`
   - `npx wrangler pages project create inspire-quiz --production-branch main`
   - `npx wrangler pages deploy dist --project-name inspire-quiz`
5. Add the secrets (it asks you to type each value):
   - `npx wrangler pages secret put ADMIN_EMAIL --project-name inspire-quiz`
   - `npx wrangler pages secret put ADMIN_PASSWORD --project-name inspire-quiz` (8+ characters)
   - optional: `SENTRY_DSN`, `OPENAI_API_KEY`
6. Deploy once more so the secrets take effect: `npx wrangler pages deploy dist --project-name inspire-quiz`.
7. Open the `https://inspire-quiz.pages.dev` link it printed and sign in with the admin email and password.
8. When done, delete the API token (Cloudflare → API Tokens) and the Codespace.

## Route B: phone only, through GitHub (slower, fiddly steps are marked ⚠)
1. ⚠ Extract the zip on your phone (Files app). Create a **private** GitHub repository.
2. ⚠ In your phone browser switch to "Desktop site", then GitHub → Add file → Upload files, and upload everything inside the project folder, keeping the folders (`src`, `public`, `migrations`, `docs`). If your phone cannot upload folders, this route is blocked: use Route A on a borrowed computer, or ask a developer to do steps 1–2.
3. Cloudflare dashboard → Storage & Databases → D1 → Create database, name it `webapp-production`. Copy its **Database ID**.
4. On GitHub open `wrangler.jsonc`, tap the pencil, replace `local-dev-placeholder` with the Database ID, and commit. (When this file exists it is the source of truth for the database binding, so do not set the binding in the dashboard.)
5. Cloudflare → D1 → your database → Console. On GitHub open `migrations/0001_initial_schema.sql` → Raw → copy everything → paste into the console → Execute. If it refuses the long paste, run it a few statements at a time.
6. Cloudflare → Workers & Pages → Create application → Pages → Connect to Git → choose the repo. Build command `npm run build`, build output directory `dist`. Save and Deploy.
7. Pages project → Settings → Variables and Secrets → add the secrets from Route A step 5. Redeploy (Deployments → Retry/Redeploy).
8. Open the link and sign in with the admin email and password.

## After it is live
- Sign-in uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` only. The demo accounts and the published demo password exist only on localhost or if you set `DEMO_MODE=true` (do not set it on a site real students use).
- Do the Sentry setup and the 5-minute test in `docs/LOGS-KIT.md`.
- Students can sign up themselves (Settings can turn that off). Create batches and assign quizzes in the dashboard.

## If logins fail
Password hashing uses a lot of processor time for a moment. On Cloudflare's free plan a request has a very small CPU allowance, so sign-in may fail with an "exceeded CPU" style error (it shows in the logs). If that happens, move the account to the paid Workers plan (about $5 a month) and sign in again.

## Checked and not checked
Dashboard steps above follow Cloudflare's current Git-integration flow (checked 24 Oct 2026). I could not run a deployment from here, so expect to adjust a label or two on first try.
