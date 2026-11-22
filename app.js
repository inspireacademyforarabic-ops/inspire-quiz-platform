'use strict'
const $ = (s, e = document) => e.querySelector(s), app = $('#app')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const dur = (s) => (s == null ? '—' : Math.floor(s / 60) + 'm ' + (s % 60) + 's')
const empty = (m) => `<p class="empty">${m}</p>`
const loc = (s) => { if (!s) return ''; const d = new Date(s); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) }
let me = null, timer = null, S = null
// Browser errors from signed-in users go to the server log (page, line, browser) so "it's broken" becomes a lookup.
const seenErr = new Set()
function reportErr(message, line) {
  const k = message + ':' + line
  if (!me || seenErr.has(k) || seenErr.size >= 5) return
  seenErr.add(k)
  fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, body: JSON.stringify({ message: String(message).slice(0, 300), page: location.hash || '/', line }) }).catch(() => {})
}
addEventListener('error', (e) => reportErr(e.message, e.lineno))
addEventListener('unhandledrejection', (e) => reportErr((e.reason && e.reason.message) || e.reason, 0))
async function api(p, body, method) {
  const r = await fetch('/api/' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.')
  return j
}
const toast = (m, bad) => { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; t.setAttribute('role', 'status'); document.body.append(t); setTimeout(() => t.remove(), 3400) }
const fail = (e) => toast(e.message, 1)
function modal(html, wide) {
  const m = document.createElement('div'); m.className = 'modal'
  m.innerHTML = `<div class="box${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove() })
  document.body.append(m); return m
}
const brand = '<div class="brand"><img class="logo" src="/static/logo-mark.webp" alt=""><b>INSPIRE Academy</b></div>'

/* ---------- auth ---------- */
let otpS = null
let OPTS = null
const selOpt = (name, label, list, val) => `<label>${label}<select name="${name}" required><option value="">Choose…</option>${list.map((x) => `<option${x === val ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`
function login(mode) {
  clearInterval(timer)
  if (mode === 'signup' && !OPTS) { app.innerHTML = '<main class="login"><p class="muted">Loading…</p></main>'; api('auth/options').then((o) => { OPTS = o; login('signup') }).catch(() => { OPTS = { exams: [], states: [], qualifications: [] }; login('signup') }); return }
  const up = mode === 'signup', ot = mode === 'otp', fg = mode === 'forgot', st2 = (ot || fg) && otpS && otpS.mode === mode
  const tabs = !up && !fg ? `<div class="seg" style="display:flex;gap:6px;margin:8px 0"><button type="button" class="ghost ${!ot ? 'on' : ''}" data-m="in" style="flex:1">Password</button><button type="button" class="ghost ${ot ? 'on' : ''}" data-m="otp" style="flex:1">One-time code</button></div>` : ''
  const dev = st2 && otpS.dev ? `<div class="card" style="background:var(--tint,#e3f1f6);margin:8px 0"><b>Test mode</b><p style="margin:.3em 0">The code is shown here only on localhost or when DEMO_MODE is on: <b id="dc" style="font-size:1.3rem;letter-spacing:.15em">${esc(otpS.dev)}</b></p></div>` : ''
  const title = up ? 'Create account' : ot ? 'Sign in with a code' : fg ? 'Reset your password' : 'Sign in'
  const ident = '<label>Email or phone number<input name="idv" required autocomplete="username"></label>'
  const body = up
    ? `<label>Full name<input name="name" required autocomplete="name"></label><label>Mobile number (10 digits)<input name="phone" type="tel" inputmode="numeric" required autocomplete="tel"></label><label>Email<input name="email" type="email" required autocomplete="username"></label>${selOpt('exam', 'Exam you are preparing for', OPTS.exams)}${selOpt('state', 'State', OPTS.states)}<label>City or district<input name="city" required maxlength="60" autocomplete="address-level2"></label>${selOpt('qualification', 'Qualification', OPTS.qualifications)}<label>Password (8+ characters)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><label><input type="checkbox" name="agree" required style="width:auto"> I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></label>`
    : (ot || fg) ? (st2
      ? `${dev}<label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>${fg ? '<label>New password (8+ characters)<input name="np" type="password" required minlength="8" autocomplete="new-password"></label>' : ''}<p class="muted"><a href="#" data-m="resend">Resend code</a> · <a href="#" data-m="${mode}x">Use a different email or phone</a></p>`
      : ident)
    : `${ident.replace('name="idv"', 'name="email"')}<label>Password<input name="password" type="password" required autocomplete="current-password"></label><p class="muted"><a href="#" data-m="forgot">Forgot password?</a></p>`
  const btn = up ? 'Create account' : st2 ? (fg ? 'Verify and set password' : 'Verify and sign in') : (ot || fg) ? 'Send code' : 'Sign in'
  app.innerHTML = `<main class="login"><form class="card" id="lf"><img class="biglogo" src="/static/logo.webp" alt="INSPIRE Academy"><h1>${title}</h1>${tabs}${body}<p id="le" class="err" role="alert"></p><button class="btn">${btn}</button>
  <p class="muted">${up ? 'Already have an account? <a href="#" data-m="in">Sign in</a>' : fg ? 'Remembered it? <a href="#" data-m="in">Sign in</a>' : 'New student? <a href="#" data-m="signup">Create an account</a>'}</p>
  ${!up && !st2 && ['localhost', '127.0.0.1'].includes(location.hostname) ? '<p class="muted">Demo: <a href="#" data-d="admin@inspire.academy">creator</a> · <a href="#" data-d="student1@inspire.academy">student</a> — password <code>Inspire@123</code></p>' : ''}
  <p class="muted"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p></form></main>`
  const ask = async (idv) => { const r = await api('auth/otp/request', { identifier: idv, purpose: fg ? 'reset' : 'login' }); otpS = { mode, idv, dev: r.dev_code || '' } }
  $('#lf').onclick = async (e) => {
    const m = e.target.closest('[data-m]'); if (m) { e.preventDefault(); const v = m.dataset.m
      if (v === 'resend') { try { await ask(otpS.idv); toast('A new code was sent if the account exists.'); login(mode) } catch (x) { fail(x) } return }
      if (v.endsWith('x')) { otpS = null; login(v.slice(0, -1)); return }
      otpS = null; login(v); return }
    const a = e.target.closest('[data-d]'); if (a) { e.preventDefault(); $('[name=email]').value = a.dataset.d; $('[name=password]').value = 'Inspire@123' }
  }
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target), b = e.target.querySelector('.btn'), label = b.textContent; b.disabled = true; b.textContent = 'Please wait…'
    try {
      if (up) me = (await api('auth/register', { name: f.get('name'), email: f.get('email'), phone: f.get('phone'), exam: f.get('exam'), state: f.get('state'), city: f.get('city'), qualification: f.get('qualification'), password: f.get('password'), agree: f.get('agree') === 'on' })).user
      else if (ot || fg) {
        if (!st2) { await ask(String(f.get('idv')).trim()); toast('If an account exists, a code has been sent.'); login(mode); return }
        if (ot) me = (await api('auth/otp/login', { identifier: otpS.idv, code: f.get('code') })).user
        else { await api('auth/otp/reset', { identifier: otpS.idv, code: f.get('code'), password: f.get('np') }); otpS = null; toast('Password updated. Sign in with your new password.'); login('in'); return }
      } else me = (await api('auth/login', { identifier: f.get('email'), password: f.get('password') })).user
      otpS = null; location.hash = me.role === 'student' ? '#/' : '#/overview'; route()
    } catch (x) { $('#le').textContent = x.message; b.disabled = false; b.textContent = label }
  }
}
function resetPage(token) {
  app.innerHTML = `<main class="login"><form class="card" id="rf">${brand}<h1>Choose a new password</h1>
  <label>New password (8+ characters)<input name="p" type="password" required minlength="8" autocomplete="new-password"></label>
  <label>Confirm new password<input name="q" type="password" required minlength="8" autocomplete="new-password"></label>
  <p id="re" class="err" role="alert"></p><button class="btn">Save password</button></form></main>`
  $('#rf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target)
    if (f.get('p') !== f.get('q')) { $('#re').textContent = 'The two passwords do not match.'; return }
    try { await api('auth/reset', { token, password: f.get('p') }); app.innerHTML = `<main class="login"><div class="card">${brand}<h1>Password updated</h1><p>You can now sign in with your new password.</p><button class="btn" id="go">Go to sign in</button></div></main>`; $('#go').onclick = () => { location.hash = ''; login() } }
    catch (x) { $('#re').textContent = x.message }
  }
}
async function acctModal() {
  const del = me.role === 'student'
  if (del && !OPTS) { try { OPTS = await api('auth/options') } catch { OPTS = { exams: [], states: [], qualifications: [] } } }
  const det = del ? `<form id="dt"><h3>My details</h3><label>Full name<input name="name" value="${esc(me.name)}" required></label><label>Mobile number<input name="phone" type="tel" inputmode="numeric" value="${esc(me.phone || '')}" required></label>${selOpt('exam', 'Exam you are preparing for', OPTS.exams, me.target_exam)}${selOpt('state', 'State', OPTS.states, me.state)}<label>City or district<input name="city" value="${esc(me.city || '')}" required maxlength="60"></label>${selOpt('qualification', 'Qualification', OPTS.qualifications, me.qualification)}<button class="btn">Save details</button></form><hr>` : ''
  const m = modal(`<h2>Account</h2><p class="muted">${esc(me.name)} · ${esc(me.email)}</p>
  ${det}
  <form id="pw"><h3>Change password</h3><label>Current password<input name="c" type="password" autocomplete="current-password" required></label><label>New password (8+ characters)<input name="n" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn">Update password</button></form>
  ${del ? `<hr><form id="dl"><h3>Delete my account</h3><p class="muted">Your name, email and sign-in are removed. Your quiz results stay in the academy records without your name. This cannot be undone.</p><label>Confirm with your password<input name="p" type="password" autocomplete="current-password" required></label><button class="btn" style="background:var(--bad)">Delete my account</button></form>` : ''}
  <div class="row"><button class="ghost" data-close>Close</button></div>`)
  if (del) $('#dt', m).onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); try { me = (await api('auth/profile', { name: f.get('name'), phone: f.get('phone'), exam: f.get('exam'), state: f.get('state'), city: f.get('city'), qualification: f.get('qualification') }, 'PUT')).user; toast('Details saved'); m.remove(); route() } catch (x) { fail(x) } }
  $('#pw', m).onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api('auth/change-password', { current_password: f.get('c'), new_password: f.get('n') }); toast('Password updated'); m.remove() } catch (x) { fail(x) } }
  if (del) $('#dl', m).onsubmit = async (e) => { e.preventDefault(); try { await api('auth/me', { password: new FormData(e.target).get('p') }, 'DELETE'); m.remove(); me = null; location.hash = ''; login(); toast('Your account was deleted') } catch (x) { fail(x) } }
}
document.addEventListener('click', (e) => { if (e.target.id === 'ac2') acctModal() })
async function resetClick(e) {
  const b = e.target.closest('[data-rs]'); if (!b) return
  try {
    const r = await api(`staff/students/${b.dataset.rs}/reset-link`, {})
    modal(`<h2>Reset link for ${esc(b.dataset.nm)}</h2><p class="muted">Send this link to the student. It works once and expires in 24 hours. It will not be shown again.</p><textarea id="rl" rows="3" readonly>${esc(r.url)}</textarea><div class="row"><button class="ghost" data-close>Close</button><span class="grow"></span><button class="btn" id="cp">Copy link</button></div>`)
    $('#cp').onclick = () => { const t = $('#rl'); t.select(); let ok = false; try { ok = document.execCommand('copy') } catch {} toast(ok ? 'Link copied' : 'Press and hold to copy') }
  } catch (x) { fail(x) }
}
async function logout() { await api('auth/logout', {}).catch(() => {}); me = null; location.hash = ''; login() }
async function boot() { if (location.hash.startsWith('#/reset/')) return resetPage(location.hash.slice(8)); try { me = (await api('auth/me')).user } catch { me = null } me ? route() : login() }
addEventListener('hashchange', () => me && route())
function route() {
  clearInterval(timer)
  const [p, id] = (location.hash.slice(2) || '').split('/')
  if (me.role === 'student') return p === 'play' ? play(id) : p === 'review' ? review(id) : home()
  const pages = { overview, quizzes, bank, students, results, settings }, k = pages[p] ? p : 'overview'
  shell(k); run(pages[k])
}
async function run(fn) { try { await fn() } catch (e) { $('#view').innerHTML = `<div class="card empty">${esc(e.message)}<br><button class="btn" onclick="route()">Retry</button></div>` } }

/* ---------- creator shell ---------- */
const NAV = [['overview', 'Overview'], ['quizzes', 'Quizzes'], ['bank', 'Question Bank'], ['students', 'Students'], ['results', 'Results & Analytics'], ['settings', 'Settings']]
function shell(k) {
  app.innerHTML = `<div class="shell${localStorage.min === '1' ? ' min' : ''}" id="sh"><aside class="side">${brand}<nav>${NAV.map(([a, l]) => `<a href="#/${a}" class="${a === k ? 'on' : ''}"><i>${l[0]}</i><span>${l}</span></a>`).join('')}</nav><button class="ghost" id="mn">⇆ <span>Collapse</span></button></aside>
  <div class="main"><header class="top"><button class="ghost menu" id="mb" aria-label="Open menu">☰</button><h1>${NAV.find((n) => n[0] === k)[1]}</h1><span class="grow"></span><button class="btn" id="cq">+ Create Quiz</button><button class="ghost" id="so">Sign out</button></header>
  <main id="view"><p class="muted">Loading…</p></main></div></div>`
  $('#mn').onclick = () => { $('#sh').classList.toggle('min'); localStorage.min = $('#sh').classList.contains('min') ? '1' : '0' }
  $('#mb').onclick = () => $('#sh').classList.toggle('open')
  $('.side').onclick = (e) => e.target.closest('a') && $('#sh').classList.remove('open')
  $('#cq').onclick = () => editQuiz(); $('#so').onclick = logout
}

/* ---------- overview ---------- */
function bars(rows, k, max) {
  if (!rows.length) return empty('No data yet')
  const m = max || Math.max(...rows.map((r) => r[k]), 1)
  return `<div class="bars" role="img" aria-label="Bar chart by day">${rows.map((r) => `<div class="bar" title="${r.d}: ${r[k]}"><em>${r[k]}</em><i style="height:${Math.max(3, (r[k] / m) * 100)}%"></i><span>${r.d.slice(5)}</span></div>`).join('')}</div>`
}
async function overview() {
  const d = await api('staff/overview'), t = d.totals
  $('#view').innerHTML = `<div class="cards">${[['Total quizzes', t.quizzes], ['Active students', t.students], ['Quiz attempts', t.attempts], ['Average score', (t.avg ?? 0) + '%']].map(([l, v]) => `<div class="card stat"><span>${l}</span><b>${v}</b></div>`).join('')}</div>
  <div class="grid2"><section class="card"><h2>Attempts per day</h2>${bars(d.days, 'n')}</section><section class="card"><h2>Average score by day (%)</h2>${bars(d.days, 'a', 100)}</section></div>
  <section class="card"><h2>Recent activity</h2>${d.activity.length ? `<ul class="list">${d.activity.map((a) => `<li>${esc(a.message)}<small>${fmt(a.created_at)}</small></li>`).join('')}</ul>` : empty('No activity yet.')}</section>`
}

/* ---------- quizzes ---------- */
async function quizzes() {
  const { quizzes: q } = await api('staff/quizzes')
  $('#view').innerHTML = q.length ? `<div class="tw"><table><thead><tr><th>Quiz</th><th>Status</th><th>Mode</th><th>Qs</th><th>Attempts</th><th>Access</th><th></th></tr></thead><tbody>${q.map((z) => `<tr><td><b>${esc(z.title)}</b><br><small>${esc(z.subject || '')} · ${esc(z.topic || '')}</small></td><td><span class="pill ${z.status}">${z.status}</span></td><td>${z.mode}</td><td>${z.question_count}</td><td>${z.attempts}</td><td>${z.access_type}${z.premium_only ? ' · premium' : ''}${z.is_paid ? ' · paid (payments off)' : ''}</td>
  <td class="acts">${[['edit', 'Edit'], ['preview', 'Preview'], z.status === 'published' ? ['unpublish', 'Unpublish'] : ['publish', 'Publish'], ['dup', 'Duplicate'], z.status !== 'archived' ? ['archive', 'Archive'] : ['restore', 'Restore']].map(([a, l]) => `<button class="ghost sm" data-a="${a}" data-id="${z.id}">${l}</button>`).join('')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('No quizzes yet. Use “Create Quiz” to start.')}</div>`
  $('#view').onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return
    const { a, id } = b.dataset
    try {
      if (a === 'edit') return editQuiz(id)
      if (a === 'preview') return preview(id)
      if (a === 'dup') { await api(`staff/quizzes/${id}/duplicate`, {}); toast('Quiz duplicated as a draft') }
      else { await api('staff/quizzes/' + id, { status: { publish: 'published', unpublish: 'draft', archive: 'archived', restore: 'draft' }[a] }, 'PUT'); toast('Quiz updated') }
      quizzes()
    } catch (x) { fail(x) }
  }
}
async function preview(id) {
  const d = await api('staff/quizzes/' + id).catch(fail); if (!d) return
  modal(`<h2>${esc(d.quiz.title)}</h2><p class="muted">${esc(d.quiz.instructions || '')}</p><ol class="pv">${d.questions.map((q) => { const o = JSON.parse(q.options_json || '[]'), c = JSON.parse(q.correct_json || '[]'); return `<li><b>${esc(q.text)}</b>${q.type === 'short_answer' ? `<br><small>Accepted: ${esc(c.join(', '))}</small>` : `<ul>${o.map((x, i) => `<li class="${c.includes(i) ? 'ok' : ''}">${esc(x)}</li>`).join('')}</ul>`}${q.explanation ? `<small>${esc(q.explanation)}</small>` : ''}</li>` }).join('') || empty('No questions yet.')}</ol><button class="btn" data-close>Close</button>`, 1)
}
const F = [['title', 'Title', 'text'], ['description', 'Description', 'text'], ['instructions', 'Instructions', 'area'], ['subject', 'Subject', 'text'], ['topic', 'Topic', 'text'], ['difficulty', 'Difficulty', ['easy', 'medium', 'hard']], ['mode', 'Mode', ['exam', 'practice', 'both']], ['duration_minutes', 'Time limit (minutes, blank = untimed)', 'number'], ['start_at', 'Opens', 'datetime-local'], ['end_at', 'Closes', 'datetime-local'], ['attempt_limit', 'Attempt limit (0 = unlimited)', 'number'], ['pass_mark', 'Pass mark (%)', 'number'], ['negative_marks', 'Negative marks per wrong answer', 'number'], ['access_type', 'Access', ['free', 'restricted']], ['price', 'Price (stored only; payments are disabled)', 'number']]
const B = [['shuffle_questions', 'Shuffle questions'], ['shuffle_options', 'Shuffle answer order'], ['show_answers', 'Reveal answers after an exam'], ['premium_only', 'Premium members only'], ['is_paid', 'Paid access (inactive until a payment provider is configured)']]
async function editQuiz(id) {
  let meta, bank, cur
  try { [meta, bank, cur] = await Promise.all([api('staff/meta'), api('staff/questions'), id ? api('staff/quizzes/' + id) : null]) } catch (e) { return fail(e) }
  const z = cur?.quiz || { mode: 'exam', difficulty: 'medium', attempt_limit: 1, pass_mark: 40, show_answers: 1, access_type: 'free' }
  const sel = new Set((cur?.questions || []).map((q) => q.id)), us = new Set(cur?.user_ids || []), bs = new Set(cur?.batch_ids || [])
  const inp = ([k, l, t]) => `<label>${l}${Array.isArray(t) ? `<select name="${k}">${t.map((o) => `<option${z[k] === o ? ' selected' : ''}>${o}</option>`).join('')}</select>` : t === 'area' ? `<textarea name="${k}" rows="2">${esc(z[k] || '')}</textarea>` : `<input name="${k}" type="${t}" ${t === 'number' ? 'min="0" step="any"' : ''} value="${esc(t === 'datetime-local' ? loc(z[k]) : z[k] ?? '')}">`}</label>`
  const m = modal(`<form><h2>${id ? 'Edit quiz' : 'Create quiz'}</h2><div class="fg">${F.map(inp).join('')}</div>
  <div class="checks">${B.map(([k, l]) => `<label class="chk"><input type="checkbox" name="${k}"${z[k] ? ' checked' : ''}>${l}</label>`).join('')}</div>
  <fieldset><legend>Questions from the bank</legend><input type="search" id="qf" placeholder="Filter…"><div class="pick">${bank.questions.map((q) => `<label class="chk" data-t="${esc((q.text + ' ' + (q.topic || '')).toLowerCase())}"><input type="checkbox" name="q" value="${q.id}"${sel.has(q.id) ? ' checked' : ''}>${esc(q.text)} <small>${q.type} · ${q.difficulty}</small></label>`).join('') || empty('Bank is empty. Add questions first.')}</div></fieldset>
  <fieldset><legend>Assign to (used when Access = restricted)</legend><div class="pick sm">${meta.batches.map((b) => `<label class="chk"><input type="checkbox" name="g" value="${b.id}"${bs.has(b.id) ? ' checked' : ''}>Batch: ${esc(b.name)}</label>`).join('')}${meta.students.map((s) => `<label class="chk"><input type="checkbox" name="u" value="${s.id}"${us.has(s.id) ? ' checked' : ''}>${esc(s.name)}</label>`).join('')}</div></fieldset>
  <div class="row"><button type="button" class="ghost" data-close>Cancel</button><span class="grow"></span><button class="btn alt" name="go" value="save">Save draft</button><button class="btn" name="go" value="pub">Save &amp; publish</button></div></form>`, 1)
  $('#qf', m).oninput = (e) => m.querySelectorAll('.pick [data-t]').forEach((l) => (l.hidden = !l.dataset.t.includes(e.target.value.toLowerCase())))
  $('form', m).onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target), b = {}
    for (const [k] of F) { let v = f.get(k); if ((k === 'start_at' || k === 'end_at') && v) v = new Date(v).toISOString(); b[k] = v }
    for (const [k] of B) b[k] = f.has(k)
    b.question_ids = f.getAll('q').map(Number); b.user_ids = f.getAll('u').map(Number); b.batch_ids = f.getAll('g').map(Number)
    if (e.submitter?.value === 'pub') b.status = 'published'
    try { const qid = id || (await api('staff/quizzes', { title: b.title })).id; await api('staff/quizzes/' + qid, b, 'PUT'); m.remove(); toast(b.status ? 'Quiz published' : 'Draft saved'); location.hash === '#/quizzes' ? route() : (location.hash = '#/quizzes') } catch (x) { fail(x) }
  }
}

/* ---------- question bank ---------- */
async function bank() {
  $('#view').innerHTML = `<div class="tools"><input id="bq" type="search" placeholder="Search text or topic…"><select id="bt"><option value="">All types</option><option value="mcq">MCQ</option><option value="true_false">True/False</option><option value="short_answer">Short answer</option></select><select id="bd"><option value="">Any difficulty</option><option>easy</option><option>medium</option><option>hard</option></select><span class="grow"></span><button class="ghost" id="imp">Import / AI</button><button class="btn" id="add">+ Add question</button></div><div id="bl"><p class="muted">Loading…</p></div>`
  const load = async () => {
    try {
      const p = new URLSearchParams({ q: $('#bq').value, type: $('#bt').value, difficulty: $('#bd').value }); [...p.keys()].forEach((k) => !p.get(k) && p.delete(k))
      const { questions: q } = await api('staff/questions?' + p)
      $('#bl').innerHTML = q.length ? `<div class="tw"><table><thead><tr><th>Question</th><th>Type</th><th>Topic</th><th>Level</th><th></th></tr></thead><tbody>${q.map((x) => `<tr><td>${esc(x.text)}<br><small>${esc(x.explanation || '')}</small></td><td>${x.type}</td><td>${esc(x.topic || '')}</td><td>${x.difficulty}</td><td><button class="ghost sm" data-del="${x.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('No questions match. Add one or import a set.')}</div>`
    } catch (e) { $('#bl').innerHTML = empty(esc(e.message)) }
  }
  ;['bq', 'bt', 'bd'].forEach((i) => ($('#' + i).oninput = load)); load()
  $('#bl').onclick = async (e) => { const d = e.target.closest('[data-del]'); if (d && confirm('Delete this question from the bank and every quiz that uses it?')) { try { await api('staff/questions/' + d.dataset.del, null, 'DELETE'); toast('Question deleted'); load() } catch (x) { fail(x) } } }
  $('#add').onclick = () => addQ(load); $('#imp').onclick = () => importQ(load)
}
function addQ(done) {
  const m = modal(`<form><h2>Add question</h2><div class="fg"><label>Type<select name="type"><option value="mcq">Multiple choice</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option></select></label>
  <label>Difficulty<select name="difficulty"><option>easy</option><option selected>medium</option><option>hard</option></select></label><label>Subject<input name="subject"></label><label>Topic<input name="topic"></label></div>
  <label>Question<textarea name="text" rows="2" required></textarea></label><label>Options (MCQ: one per line)<textarea name="options" rows="4"></textarea></label>
  <label>Correct answer — MCQ: option number(s) like <code>2</code> or <code>1,3</code>; True/False: <code>True</code> or <code>False</code>; Short answer: accepted answers separated by commas<input name="correct" required></label>
  <label>Explanation<textarea name="explanation" rows="2"></textarea></label><div class="row"><button type="button" class="ghost" data-close>Cancel</button><span class="grow"></span><button class="btn">Save question</button></div></form>`)
  $('form', m).onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), c = f.correct.split(',').map((s) => s.trim()).filter(Boolean)
    const d = { ...f, options: [], correct: c }
    if (f.type === 'mcq') { d.options = f.options.split('\n').map((s) => s.trim()).filter(Boolean); d.correct = c.map((x) => Number(x) - 1) }
    if (f.type === 'true_false') { d.options = ['True', 'False']; d.correct = [/^t/i.test(c[0]) ? 0 : 1] }
    try { await api('staff/questions', d); m.remove(); toast('Question saved'); done() } catch (x) { fail(x) }
  }
}
function importQ(done) {
  const m = modal(`<h2>Import or generate questions</h2><p class="muted">Pasted text, CSV, or AI drafts are reviewed here before anything is saved.</p>
  <label>Paste questions<textarea id="it" rows="6" placeholder="Question?&#10;A) one&#10;B) two ✅&#10;Ex: explanation"></textarea></label>
  <div class="row"><select id="if"><option value="text">Text</option><option value="csv">CSV</option></select><button class="btn alt" id="ip">Parse for review</button><span class="grow"></span><input id="ai" placeholder="AI topic, e.g. Mu'allaqat"><button class="ghost" id="ig">Generate with AI</button></div><div id="rv"></div>`, 1)
  let drafts = []
  const show = () => { $('#rv', m).innerHTML = drafts.length ? `<h3>Review ${drafts.length} question(s)</h3><div class="pick">${drafts.map((d, i) => `<div class="rv"><label class="chk"><input type="checkbox" data-k="${i}" checked> <input data-t="${i}" value="${esc(d.text)}"></label><small>${d.type} · ${(d.options || []).map((o, j) => (JSON.stringify(d.correct).includes(String(j)) && d.type !== 'short_answer' ? '✔ ' : '') + esc(o)).join(' | ') || esc(d.correct.join(', '))}</small></div>`).join('')}</div><button class="btn" id="sv">Save selected to bank</button>` : ''
    const s = $('#sv', m); if (s) s.onclick = async () => { const keep = drafts.map((d, i) => ({ ...d, text: $(`[data-t="${i}"]`, m).value })).filter((_, i) => $(`[data-k="${i}"]`, m).checked); try { await api('staff/questions', { questions: keep }); m.remove(); toast(keep.length + ' questions added'); done() } catch (x) { fail(x) } } }
  $('#ip', m).onclick = async () => { try { const r = await api('staff/import', { text: $('#it', m).value, format: $('#if', m).value }); drafts = r.questions; if (!drafts.length) toast('No questions recognised. Check the format.', 1); show() } catch (x) { fail(x) } }
  $('#ig', m).onclick = async () => { try { drafts = (await api('staff/ai', { topic: $('#ai', m).value, count: 5 })).questions; show() } catch (x) { fail(x) } }
}

/* ---------- students, results, settings ---------- */
async function students() {
  $('#view').onclick = resetClick
  const { students: s } = await api('staff/meta')
  $('#view').innerHTML = s.length ? `<div class="tools"><span class="grow"></span><a class="btn alt" href="/api/staff/students.csv">Export students (CSV)</a></div><div class="tw"><table><thead><tr><th>Student</th><th>Contact</th><th>Exam</th><th>Place</th><th>Qualification</th><th>Joined</th><th>Plan</th><th>Attempts</th><th>Avg score</th><th>Last sign-in</th><th></th></tr></thead><tbody>${s.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}<br><small>${esc(x.phone || '—')}</small></td><td>${esc(x.target_exam || '—')}</td><td>${esc([x.city, x.state].filter(Boolean).join(', ') || '—')}</td><td>${esc(x.qualification || '—')}</td><td>${fmt(x.created_at)}</td><td>${x.is_premium ? 'Premium' : 'Free'}</td><td>${x.attempts}</td><td>${x.avg ?? '—'}${x.avg != null ? '%' : ''}</td><td>${fmt(x.last_login_at)}</td><td><button class="ghost sm" data-rs="${x.id}" data-nm="${esc(x.name)}">Reset password</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('No students yet.')}</div>`
}
async function results() {
  const [{ quizzes: q }, { students: s }] = await Promise.all([api('staff/quizzes'), api('staff/meta')])
  $('#view').innerHTML = `<div class="tools"><select id="rq"><option value="">All quizzes</option>${q.map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select><select id="ru"><option value="">All students</option>${s.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input id="rf" type="date" aria-label="From date"><span class="grow"></span><a class="btn alt" id="csv" href="/api/staff/results?format=csv">Export CSV</a></div><div id="rl"></div>`
  const qs = () => { const p = new URLSearchParams(); if ($('#rq').value) p.set('quiz_id', $('#rq').value); if ($('#ru').value) p.set('user_id', $('#ru').value); if ($('#rf').value) p.set('from', $('#rf').value); return p }
  const load = async () => {
    $('#csv').href = '/api/staff/results?format=csv&' + qs()
    try {
      const d = await api('staff/results?' + qs()), mx = Math.max(...d.dist, 1)
      $('#rl').innerHTML = d.rows.length ? `<section class="card"><h2>Score distribution</h2><div class="bars">${d.dist.map((n, i) => `<div class="bar"><em>${n}</em><i style="height:${Math.max(3, (n / mx) * 100)}%"></i><span>${i * 20}–${i * 20 + 20}%</span></div>`).join('')}</div></section><div class="tw"><table><thead><tr><th>Student</th><th>Quiz</th><th>Mode</th><th>Date</th><th>Score</th><th>Time</th><th>Result</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${esc(r.student)}</td><td>${esc(r.quiz)}</td><td>${r.mode}</td><td>${fmt(r.submitted_at)}</td><td>${r.score}/${r.max_score} (${Math.round(r.percent)}%)</td><td>${dur(r.time_taken_sec)}</td><td><span class="pill ${r.passed ? 'published' : 'archived'}">${r.passed ? 'Pass' : 'Fail'}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('No results match these filters.')}</div>`
    } catch (e) { $('#rl').innerHTML = empty(esc(e.message)) }
  }
  ;['rq', 'ru', 'rf'].forEach((i) => ($('#' + i).onchange = load)); load()
}
async function settings() {
  const s = await api('staff/settings'), row = (n, ok, h) => `<li><b>${n}</b> <span class="pill ${ok ? 'published' : 'draft'}">${ok ? 'Configured' : 'Not configured'}</span><small>${h}</small></li>`
  $('#view').innerHTML = `<section class="card"><h2>Integrations</h2><ul class="list">${row('AI question generation', s.ai, 'Set the OPENAI_API_KEY secret (optional OPENAI_BASE_URL, OPENAI_MODEL) with <code>wrangler pages secret put</code>.')}${row('Error tracking & logs (Sentry)', s.monitoring, 'Set the SENTRY_DSN variable. See docs/LOGS-KIT.md.')}${row('Telegram bot', s.telegram, 'Set TELEGRAM_BOT_TOKEN. The bot itself is not built yet; the web app works without it.')}${row('Payments', s.payments, 'Disabled. Paid quizzes stay locked until an administrator wires a payment provider and grants access.')}</ul></section><section class="card"><h2>Account</h2><p>Signed in as <b>${esc(me.name)}</b> (${me.role}).</p><button class="btn" id="ac2">Change password</button></section>`
}

/* ---------- student portal ---------- */
function sShell(body) { app.innerHTML = `<header class="top stu">${brand}<span class="grow"></span><span class="muted">${esc(me.name)}</span><button class="ghost" id="ac">Account</button><button class="ghost" id="so">Sign out</button></header><main class="wrap" id="view">${body}</main><p class="muted" style="text-align:center"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>`; $('#so').onclick = logout; $('#ac').onclick = acctModal }
async function home() {
  sShell('<p class="muted">Loading…</p>')
  try {
    const d = await api('student/home')
    $('#view').innerHTML = `${!me.phone || !me.target_exam ? '<div class="card"><b>Please complete your details</b><p class="muted">Your mobile number, exam, state, city and qualification help your teachers support you.</p><button class="btn" id="ac2">Add my details</button></div>' : ''}<h1>Your quizzes</h1>${d.quizzes.length ? `<div class="cards">${d.quizzes.map((z) => `<article class="card"><h2>${esc(z.title)}</h2><p class="muted">${esc(z.subject || '')} · ${z.question_count} questions${z.duration_minutes ? ' · ' + z.duration_minutes + ' min' : ''}${z.end_at ? ' · due ' + fmt(z.end_at) : ''}</p>${z.allowed ? (z.resume_id ? `<a class="btn" href="#/play/${z.resume_id}">Resume attempt</a>` : z.mode === 'both' ? `<button class="btn" data-s="${z.id}" data-m="exam">Start exam</button> <button class="btn alt" data-s="${z.id}" data-m="practice">Practice</button>` : `<button class="btn" data-s="${z.id}" data-m="${z.mode}">${z.mode === 'practice' ? 'Start practice' : 'Start exam'}</button>`) : `<p class="err">${esc(z.reason)}</p>`}${z.attempts_left != null ? `<small>${z.attempts_left} attempt(s) left</small>` : ''}</article>`).join('')}</div>` : empty('No quizzes are assigned to you yet.')}
    <h2>Recent scores</h2>${d.recent.length ? `<div class="tw"><table><thead><tr><th>Quiz</th><th>Date</th><th>Score</th><th>Result</th><th></th></tr></thead><tbody>${d.recent.map((r) => `<tr><td>${esc(r.title)}</td><td>${fmt(r.submitted_at)}</td><td>${Math.round(r.percent)}%</td><td>${r.passed ? 'Pass' : 'Fail'}</td><td><a href="#/review/${r.id}">Review</a></td></tr>`).join('')}</tbody></table></div>` : empty('Completed attempts will appear here.')}`
    $('#view').onclick = async (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return; b.disabled = true
      try { const z = d.quizzes.find((x) => x.id == b.dataset.s), mm = b.dataset.m
        if (!confirm(`${z.title}\n\n${z.instructions || 'Answer all questions.'}\n\n${mm === 'exam' ? 'Exam mode: answers are hidden until you submit.' : 'Practice mode: you get feedback after each answer.'}${z.duration_minutes && mm === 'exam' ? '\nThe timer starts now.' : ''}\n\nStart?`)) { b.disabled = false; return }
        location.hash = '#/play/' + (await api(`student/quizzes/${z.id}/start`, { mode: mm })).attempt_id } catch (x) { fail(x); b.disabled = false }
    }
  } catch (e) { $('#view').innerHTML = `<div class="card empty">${esc(e.message)}</div>` }
}
async function play(id) {
  sShell('<p class="muted">Loading…</p>')
  try { const d = await api('student/attempts/' + id); if (d.done) return (location.hash = '#/review/' + id); S = { d, i: 0, a: d.answers, id }; draw(); if (d.attempt.deadline_at) timer = setInterval(tick, 1000) }
  catch (e) { $('#view').innerHTML = `<div class="card empty">${esc(e.message)}</div>` }
}
async function tick() {
  const el = $('#tm'); if (!el) return
  const r = Math.max(0, Math.round((Date.parse(S.d.attempt.deadline_at) - Date.now()) / 1000))
  el.textContent = Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); el.classList.toggle('warn', r < 60)
  if (!r) { clearInterval(timer); toast('Time is up. Submitting…'); await api(`student/attempts/${S.id}/submit`, {}).catch(() => {}); location.hash = '#/review/' + S.id }
}
async function save(p) {
  const q = S.d.questions[S.i]
  try { S.a[q.question_id] = await api(`student/attempts/${S.id}/answer`, { question_id: q.question_id, ...p }); draw() }
  catch (e) { fail(e); if (/Time is up/.test(e.message)) location.hash = '#/review/' + S.id }
}
function draw() {
  const { d, i, a } = S, q = d.questions[i], r = a[q.question_id] || {}, pr = d.attempt.mode === 'practice', fb = pr && r.correct !== undefined, co = r.correct_options || []
  const st = (x) => { const y = a[x.question_id] || {}; return (y.selected?.length || y.text ? 'done ' : '') + (y.flagged ? 'flag ' : '') + (x.index === i ? 'cur' : '') }
  $('#view').innerHTML = `<div class="ptop"><div><h1>${esc(d.attempt.quiz_title)}</h1><span class="pill ${pr ? 'draft' : 'published'}">${pr ? 'Practice' : 'Exam'}</span></div><span class="timer" id="tm" aria-live="off">${d.attempt.deadline_at ? '…' : 'Untimed'}</span></div>
  <nav class="pal" aria-label="Question navigator">${d.questions.map((x) => `<button class="${st(x)}" data-g="${x.index}" aria-label="Question ${x.index + 1}">${x.index + 1}</button>`).join('')}</nav>
  <section class="card"><small>Question ${i + 1} of ${d.questions.length}${q.multi ? ' · select all that apply' : ''}</small><h2>${esc(q.text)}</h2>
  ${q.type === 'short_answer' ? `<input id="tx" class="tx" placeholder="Type your answer" value="${esc(r.text || '')}" ${fb ? 'disabled' : ''}>` : q.options.map((o, k) => `<label class="opt ${fb ? (co.includes(k) ? 'ok' : (r.selected || []).includes(k) ? 'bad' : '') : ''}"><input type="${q.multi ? 'checkbox' : 'radio'}" name="o" value="${k}" ${(r.selected || []).includes(k) ? 'checked' : ''} ${fb ? 'disabled' : ''}>${esc(o)}</label>`).join('')}
  ${pr && !fb ? '<button class="btn alt" id="ck">Check answer</button>' : ''}
  ${fb ? `<div class="fb ${r.correct ? 'ok' : 'bad'}" role="status"><b>${r.correct ? 'Correct' : 'Incorrect'}</b>${q.type === 'short_answer' ? ` — accepted: ${esc(co.join(', '))}` : ''}${r.explanation ? `<p>${esc(r.explanation)}</p>` : ''}</div>` : ''}</section>
  <div class="row"><button class="ghost" id="pv" ${i ? '' : 'disabled'}>← Previous</button><button class="ghost" id="fl">${r.flagged ? '⚑ Unflag' : '⚐ Flag for review'}</button><span class="grow"></span><button class="ghost" id="nx" ${i < d.questions.length - 1 ? '' : 'disabled'}>Next →</button><button class="btn" id="sb">Submit</button></div>`
  tick()
  const mine = () => (q.type === 'short_answer' ? { text: $('#tx').value } : { selected: [...document.querySelectorAll('[name=o]:checked')].map((x) => +x.value) })
  document.querySelectorAll('.pal [data-g]').forEach((b) => (b.onclick = () => { S.i = +b.dataset.g; draw() }))
  $('#pv').onclick = () => { S.i--; draw() }; $('#nx').onclick = () => { S.i++; draw() }
  $('#fl').onclick = () => save({ flagged: !r.flagged })
  if (!pr && !fb) { document.querySelectorAll('[name=o]').forEach((x) => (x.onchange = () => save(mine()))); const t = $('#tx'); if (t) t.onchange = () => save(mine()) }
  if ($('#ck')) $('#ck').onclick = () => save(mine())
  $('#sb').onclick = () => {
    const done = d.questions.filter((x) => (a[x.question_id]?.selected?.length || a[x.question_id]?.text)).length, fl = d.questions.filter((x) => a[x.question_id]?.flagged).length
    const m = modal(`<h2>Submit your attempt?</h2><p>${done} of ${d.questions.length} answered · ${d.questions.length - done} unanswered · ${fl} flagged for review.</p><p class="muted">You cannot change answers after submitting.</p><div class="row"><button class="ghost" data-close>Keep working</button><span class="grow"></span><button class="btn" id="yes">Submit now</button></div>`)
    $('#yes', m).onclick = async () => { try { clearInterval(timer); await api(`student/attempts/${S.id}/submit`, {}); m.remove(); location.hash = '#/review/' + S.id } catch (x) { fail(x) } }
  }
}
async function review(id) {
  sShell('<p class="muted">Loading…</p>')
  try {
    const d = await api('student/attempts/' + id); if (!d.done) return (location.hash = '#/play/' + id)
    const A = d.attempt, Q = d.questions
    $('#view').innerHTML = `<div class="row noprint"><a href="#/">← Home</a><span class="grow"></span><button class="ghost" onclick="print()">Print / save PDF</button></div><h1>${esc(d.quiz.title)} — report</h1>
    <div class="cards"><div class="card stat"><span>Score</span><b>${A.score}/${A.max_score}</b></div><div class="card stat"><span>Percent</span><b>${Math.round(A.percent)}%</b></div><div class="card stat"><span>Result</span><b class="${A.passed ? 'okc' : 'badc'}">${A.passed ? 'Passed' : 'Not passed'}</b></div><div class="card stat"><span>Time taken</span><b>${dur(A.time_taken_sec)}</b></div></div>
    <p>${A.correct_count} correct · ${A.wrong_count} wrong · ${A.unanswered_count} unanswered · submitted ${fmt(A.submitted_at)}</p>
    <nav class="pal noprint" aria-label="Question navigator">${Q.map((x) => `<a class="${x.answered ? (x.correct ? 'okb' : 'badb') : ''}" href="#q${x.index}" onclick="document.getElementById('q${x.index}').scrollIntoView({behavior:'smooth'});return false">${x.index + 1}</a>`).join('')}</nav>
    ${d.reveal ? '' : '<p class="muted">Correct answers and explanations are hidden by your instructor for this quiz.</p>'}
    ${Q.map((x) => `<section class="card" id="q${x.index}"><small>Question ${x.index + 1} · ${x.answered ? (x.correct ? 'Correct' : 'Incorrect') : 'Unanswered'}${x.flagged ? ' · flagged' : ''}</small><h3>${esc(x.text)}</h3>${x.type === 'short_answer' ? `<p>Your answer: <b>${esc(x.text_answer || '—')}</b></p>${d.reveal ? `<p class="okc">Accepted: ${esc((x.correct_options || []).join(', '))}</p>` : ''}` : x.options.map((o, k) => `<div class="opt ${d.reveal && (x.correct_options || []).includes(k) ? 'ok' : x.selected.includes(k) ? (d.reveal ? 'bad' : 'sel') : ''}">${x.selected.includes(k) ? '● ' : '○ '}${esc(o)}${d.reveal && (x.correct_options || []).includes(k) ? ' ✔' : ''}</div>`).join('')}${d.reveal && x.explanation ? `<p class="fb">${esc(x.explanation)}</p>` : ''}</section>`).join('')}`
  } catch (e) { $('#view').innerHTML = `<div class="card empty">${esc(e.message)}<br><a href="#/">Back</a></div>` }
}
boot()
