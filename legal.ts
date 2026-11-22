import { Hono } from 'hono'
import type { AppEnv } from '../types'

const legal = new Hono<AppEnv>()
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

function page(c: any, title: string, body: string) {
  const op = esc(c.env.OPERATOR_NAME || 'INSPIRE Academy')
  const mail = c.env.CONTACT_EMAIL ? esc(c.env.CONTACT_EMAIL) : '[add your contact email in CONTACT_EMAIL]'
  const reviewed = c.env.LEGAL_REVIEWED === 'true'
  const banner = reviewed ? '' : '<div class="note"><b>Draft, not reviewed.</b> This text is a starting point written without knowledge of your legal obligations. Have it checked by a legal adviser, fill in the bracketed items, then set <code>LEGAL_REVIEWED=true</code> to remove this box. Items to confirm: rules for learners under 18; which law applies to you; how long logs are kept by each provider; the governing-law line in the Terms.</div>'
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${op}</title><link rel="icon" type="image/png" href="/static/favicon-64.png"><style>
:root{--bg:#f3f7fb;--sf:#fff;--ink:#10243a;--mut:#4a6076;--ln:#dbe5ef;--bl:#0b4f9c}@media(prefers-color-scheme:dark){:root{--bg:#0d1824;--sf:#14263a;--ink:#e7eef6;--mut:#9fb3c8;--ln:#27405a;--bl:#6db3ff}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:760px;margin:0 auto;padding:16px}article{background:var(--sf);border:1px solid var(--ln);border-radius:16px;padding:20px}
h1{font-size:1.6rem;margin:.2em 0}h2{font-size:1.1rem;margin:1.4em 0 .3em}a{color:var(--bl)}.mut{color:var(--mut)}.note{background:#fff4d6;color:#4a3300;border:1px solid #e5c76b;border-radius:12px;padding:12px;margin:0 0 16px;font-size:.92rem}code{background:var(--bg);padding:1px 5px;border-radius:4px}li{margin:.25em 0}</style></head><body><main><p><a href="/">← Back to ${op}</a></p>${banner}<article>${body.replaceAll('{OP}', op).replaceAll('{MAIL}', mail)}</article><p class="mut" style="text-align:center"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p></main></body></html>`)
}

legal.get('/privacy', (c) => page(c, 'Privacy Policy', `<h1>Privacy Policy</h1><p class="mut">Last updated: [add date]</p>
<p>{OP} (“we”) runs this quiz platform. This page explains what personal data we handle and why. Questions: {MAIL}.</p>
<h2>What we collect</h2><ul><li><b>Account details:</b> your name, email address, mobile number and role.</li><li><b>Student details:</b> the exam you are preparing for, your state, your city or district, and your qualification. We use them to contact and support you; we do not ask for your date of birth or ID numbers. Your password is stored only as a salted hash, never in readable form.</li><li><b>One-time codes:</b> when you sign in or reset your password with a code, we keep a scrambled (hashed) copy of the code for 5 minutes. We send the code to your email or phone through the academy’s own email or SMS service.</li><li><b>Quiz activity:</b> the quizzes you open, your answers, scores, times and whether you passed.</li><li><b>Technical data:</b> your IP address, browser type and the pages or API calls you make, which our hosting and error-logging providers process to keep the service running and to fix problems. Our logs use an internal user number and a request code rather than your name or email.</li><li><b>Cookie:</b> one essential cookie that keeps you signed in. We do not use advertising or analytics cookies.</li></ul>
<h2>Why we use it</h2><p>To run your account, send you sign-in codes, deliver quizzes, show you and your teachers your results, keep the service secure, and find and fix errors.</p>
<h2>Who else handles it</h2><ul><li><b>Email or SMS provider:</b> only the one the academy chooses for one-time codes. It receives your email address or phone number and the code.</li><li><b>Cloudflare:</b> hosting and the database where accounts and results are stored.</li><li><b>Sentry:</b> error reports and logs, only if the academy has turned this on.</li><li><b>OpenAI:</b> only when a teacher uses AI question generation. Student names, emails and results are not sent for this.</li></ul><p>We do not sell your data.</p>
<h2>Who can see your results</h2><p>You, and the teachers and administrators of {OP}.</p>
<h2>How long we keep it</h2><p>While your account exists. If you delete your account, your name, email and sign-in details are removed and your quiz results are kept in the academy’s records without identifying details. Provider logs are kept for a limited time set by each provider [confirm the periods you use].</p>
<div dir="rtl" lang="ar" style="font-family:'Noto Naskh Arabic',serif;font-size:1.1rem;line-height:1.9"><b>ملخص بالعربية</b><ul><li>نجمع اسمك وبريدك الإلكتروني (ورقم هاتفك إن أدخلته) ونتائج اختباراتك لنقدّم لك الخدمة.</li><li>لا نبيع بياناتك.</li><li>يمكنك تغيير كلمة المرور أو حذف حسابك في أي وقت.</li></ul></div>
<h2>Your choices</h2><ul><li>Change your password or delete your account from the Account button when signed in.</li><li>Ask us to correct or explain your data at {MAIL}.</li></ul>
<h2>Learners under 18</h2><p>[Confirm with your legal adviser what applies, and what the academy needs from parents or guardians.]</p>
<h2>Changes</h2><p>If we change this policy we will update the date above.</p>`))

legal.get('/terms', (c) => page(c, 'Terms of Service', `<h1>Terms of Service</h1><p class="mut">Last updated: [add date]</p>
<p>These terms apply when you use the quiz platform run by {OP}. By creating an account you agree to them and to our <a href="/privacy">Privacy Policy</a>.</p>
<h2>Your account</h2><p>Give accurate details and keep your password private. You are responsible for activity on your account. Tell us at {MAIL} if you think someone else is using it.</p>
<h2>Using the platform</h2><ul><li>Take quizzes honestly and only as yourself. Do not share exam questions or answers.</li><li>Do not try to break, overload or get around the platform, including its access rules and timers.</li><li>Do not upload unlawful or harmful content.</li></ul>
<h2>Content</h2><p>Quizzes, questions and explanations belong to {OP} or its content creators. You may use them for your own study. You may not copy or resell them.</p>
<h2>Results</h2><p>Scores show how you did on a quiz. They are practice and do not guarantee any result in a real exam.</p>
<h2>Availability</h2><p>We aim to keep the service running but do not promise it will always be available or error-free. We may change or remove quizzes or features.</p>
<h2>Ending your access</h2><p>You can delete your account at any time. We may suspend accounts that break these terms.</p>
<h2>Liability and law</h2><p>[Add the limits on liability that apply to you.] These terms are governed by the law of [country or state].</p>
<h2>Changes and contact</h2><p>We may update these terms and will change the date above. Contact: {MAIL}.</p>`))

export default legal
