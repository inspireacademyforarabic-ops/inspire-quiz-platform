# Go live from your phone with GitHub (no computer, no command line)

The workflow in `.github/workflows/deploy.yml` creates the database, applies the migrations, creates the site and publishes it on Cloudflare. You only add a few secrets.

1. **Cloudflare account** (free): note your **Account ID** (dashboard home, right side, under the account name).
2. **API token**: Cloudflare → My Profile → API Tokens → Create Token → Custom token. Permissions: *Account · Cloudflare Pages · Edit*, *Account · D1 · Edit*, *Account · Account Settings · Read*. Copy the token (it is shown once).
3. **GitHub**: create a repository and upload this project (or use a Codespace, see `docs/DEPLOY.md`, Route C). Then open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (8+ characters). This creates your first creator/admin sign-in.
   - `OPERATOR_NAME` and `CONTACT_EMAIL` (shown in the privacy policy and terms)
   - optional: `OTP_WEBHOOK_URL` / `OTP_WEBHOOK_TOKEN` (one-time codes), `SENTRY_DSN`, `OPENAI_API_KEY`
4. Optional: **Variables → New repository variable** `PAGES_PROJECT` to choose the site name (default `inspire-academy`, giving `https://inspire-academy.pages.dev`). If that name is taken, pick another.
5. Open the **Actions** tab → **Deploy to Cloudflare** → **Run workflow**. When it turns green, the address is shown at the bottom of the run.
6. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then share the address with students. For the Android app, use that address.

Not tested against a real Cloudflare account: if a step fails, the run log names the step; send it to me.
