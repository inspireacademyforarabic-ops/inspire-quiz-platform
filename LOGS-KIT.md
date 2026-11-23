# LOGS Kit for the INSPIRE quiz platform

Adapted from the Codikko Academy LOGS Kit (written for Next.js on Vercel) to this project: Hono on Cloudflare Pages with D1.
Six cameras. Tick each when it is true for your deployment.

| # | Camera | What this project does | You still need to |
|---|--------|------------------------|-------------------|
| 1 | Error tracking | `Sentry.withSentry` wraps the app; `onError` sends every unhandled error to Sentry with its `requestId` and `userId`. Browser errors from signed-in users are posted to `/api/client-error`. | Create a Sentry project (platform: Cloudflare), set `SENTRY_DSN`. |
| 2 | Logs kept for days | Every line goes to Sentry Logs (`Sentry.logger`) and to the console as one JSON line. | Check your Sentry plan's log retention (the kit lists the free plan as 5 GB, 30-day lookback; confirm on sentry.io/pricing). |
| 3 | The important moments | Logged with their result: login ok/failed, signup, password change, quiz created/updated/duplicated, questions added, attempt started/submitted/auto-submitted, access denied, results exported, AI generation failed (as an error), demo data seeded. | Add a line for anything new that can fail quietly. |
| 4 | Who + which request | `requestId` (also returned in the `x-request-id` header) and `userId` on every API line. | Search `userId=<id>` in Sentry Logs to read one student's session. |
| 5 | Nothing secret | `scrub()` redacts keys like password/token/cookie/card/otp, drops whole objects, caps strings at 300 chars. `beforeSendLog` redacts again before Sentry. Failed logins log only the email *domain*. | Never add `JSON.stringify(body)` or a whole user object to a log. |
| 6 | An alert | Not automatic. | Sentry → Alerts → Create Alert: (a) new issue → email you; (b) spike: more than 10 errors in 1 hour. Turn on phone notifications for that email. |

## Retention on Cloudflare (checked 24 Oct 2026, plans change)
Cloudflare Workers Logs keeps 3 days on Workers Free and 7 days on Workers Paid (Cloudflare docs, Workers pricing). Cloudflare also says new Observability pricing starts 1 Dec 2026, with 7-day retention on Free. Workers Logs is switched on with `observability.enabled` in a Worker's wrangler file; whether it applies to a Pages project like this one is something to confirm in your dashboard. Treat Sentry Logs as the copy that is kept for days.

## Setup (15 minutes)
1. `npm install` (adds `@sentry/cloudflare`).
2. Create a Sentry project, copy its DSN.
3. Local: copy `.dev.vars.example` to `.dev.vars` and paste the DSN. Production: Cloudflare → your Pages project → Settings → Variables and Secrets → add `SENTRY_DSN`.
4. Redeploy. Settings → Integrations in the app shows "Error tracking & logs (Sentry)" as Configured.

## The 5-minute test (do it tonight, and after every big change)
Ask a friend to use the app, do one thing, and send you only "it's broken" and roughly when. Then find, within 5 minutes:
1. **Which page?** Sentry issue → the request path, or the browser-error line's `page`.
2. **When?** The log timestamp.
3. **What error?** Message and code line.
4. **What did they do first?** Search `userId=<their id>` and read the lines in order.

To see an error arrive on purpose: sign in as admin and open `/api/staff/_test-error` on the deployed site. You should get a 500 with a code, and the same code (`requestId`) in Sentry.

| If you couldn't… | Missing |
|---|---|
| see the error at all | 1 Error tracking |
| find logs from that time | 2 Logs kept for days |
| see what the user did | 3 Important moments |
| tell which lines were theirs | 4 Who + which request |
| saw a password or token while searching | 5 Nothing secret (fix now) |
| only knew because they told you | 6 An alert |

## Open points to verify when you deploy
- The app is built as a Pages `_worker.js`. `withSentry` is Sentry's documented wrapper for Hono on Workers; Sentry also documents a Pages-specific plugin. If the test error does not appear in Sentry, follow Sentry's Cloudflare Pages guide for the wrapper.
- The quick phone apps (admin and student HTML pages) have no server, so they have no server logs.
