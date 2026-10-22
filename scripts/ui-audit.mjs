/**
 * Interactive UI audit: logs in through the real login form, walks every nav
 * item and page, and reports HTTP status, console errors, failed requests and
 * key content per page. Run against a running dev server:
 *
 *   node scripts/ui-audit.mjs [baseURL]
 */
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const baseURL = process.argv[2] ?? 'http://localhost:9000'

function envFrom(text, key) {
  const raw = text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim()
  if (raw === undefined) return undefined
  // .env values may be quoted; the quotes are syntax, not part of the value.
  return raw.replace(/^["'](.*)["']$/, '$1')
}

const envLocal = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '')
const email = envFrom(envLocal, 'ADMIN_EMAIL')
const password = envFrom(envLocal, 'ADMIN_PASSWORD')
if (!email || !password) {
  console.error('ADMIN_EMAIL / ADMIN_PASSWORD not found in .env.local')
  process.exit(2)
}

const report = []
const browser = await chromium.launch()

async function newPage() {
  const context = await browser.newContext()
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('requestfailed', (req) => {
    // Next.js prefetches RSC payloads for links; when a navigation supersedes
    // one (e.g. the post-login router.replace), Chromium reports the prefetch
    // as ERR_ABORTED. That is expected churn, not a broken request.
    if (req.failure()?.errorText === 'net::ERR_ABORTED' && req.url().includes('_rsc=')) return
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`)
  })
  return { context, page, consoleErrors, pageErrors, failedRequests }
}

function record(name, status, checks, extra = {}) {
  report.push({ name, status, checks, ...extra })
  const mark = status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL'
  console.log(`[${mark}] ${name}`)
  for (const c of checks) {
    const cm = c.ok ? '  ok  ' : '  FAIL'
    console.log(`${cm} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`)
  }
}

// ---- 1. Logged-out behaviour -------------------------------------------------
{
  const { context, page, consoleErrors, pageErrors } = await newPage()
  const res = await page.goto(`${baseURL}/`, { waitUntil: 'networkidle' })
  const landed = new URL(page.url()).pathname
  record('Redirect: / (logged out) -> login', res?.status() === 200 && landed === '/auth/login' ? 'ok' : 'fail', [
    { ok: res?.status() === 200, label: 'HTTP 200', detail: `got ${res?.status()}` },
    { ok: landed === '/auth/login', label: 'landed on /auth/login', detail: landed },
  ], { consoleErrors, pageErrors })
  await context.close()
}

// ---- 2. Login through the form ----------------------------------------------
let authedContext
{
  const { context, page, consoleErrors, pageErrors, failedRequests } = await newPage()
  await page.goto(`${baseURL}/auth/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ])
  const landed = new URL(page.url()).pathname
  record('Login form (admin)', landed === '/' ? 'ok' : 'fail', [
    { ok: landed === '/', label: 'redirected to / after submit', detail: landed },
    { ok: consoleErrors.length === 0, label: 'no console errors', detail: consoleErrors.join(' | ') },
    { ok: pageErrors.length === 0, label: 'no page errors', detail: pageErrors.join(' | ') },
    { ok: failedRequests.length === 0, label: 'no failed requests', detail: failedRequests.join(' | ') },
  ])
  authedContext = context
}

// ---- 3. Walk every page via the real nav -------------------------------------
const pages = [
  {
    path: '/',
    label: 'Overview (dashboard)',
    checks: [
      { sel: 'h1, h2', label: 'has a heading' },
      { text: /bandwidth|traffic|top/i, label: 'top-N bandwidth section (F-24)' },
    ],
  },
  {
    path: '/devices',
    label: 'Devices list',
    checks: [
      { text: /devices/i, label: 'devices heading/section (F-10)' },
      { sel: 'table, [role="table"], tbody tr', label: 'device table rows (F-10)' },
    ],
  },
  {
    path: '/alerts',
    label: 'Alerts',
    checks: [{ text: /alert/i, label: 'alerts heading (F-33)' }],
  },
  {
    path: '/settings',
    label: 'Settings',
    checks: [
      { text: /settings/i, label: 'settings heading (F-50)' },
      { sel: 'form, input, select', label: 'editable form controls (F-50/F-51)' },
    ],
  },
]

const page = await authedContext.newPage()
const consoleErrors = []
const pageErrors = []
const failedRequests = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('requestfailed', (r) => {
  if (r.failure()?.errorText === 'net::ERR_ABORTED' && r.url().includes('_rsc=')) return
  failedRequests.push(`${r.method()} ${r.url()}`)
})

for (const p of pages) {
  consoleErrors.length = 0
  pageErrors.length = 0
  failedRequests.length = 0
  const res = await page.goto(`${baseURL}${p.path}`, { waitUntil: 'networkidle' })
  const checks = [{ ok: res?.status() === 200, label: 'HTTP 200', detail: `got ${res?.status()}` }]
  for (const c of p.checks) {
    if (c.text) {
      const n = await page.locator(`text=${c.text}`).count()
      checks.push({ ok: n > 0, label: c.label, detail: n > 0 ? undefined : `no match for ${c.text}` })
    }
    if (c.sel) {
      const n = await page.locator(c.sel).count()
      checks.push({ ok: n > 0, label: c.label, detail: n > 0 ? `${n} found` : `missing: ${c.sel}` })
    }
  }
  checks.push({ ok: consoleErrors.length === 0, label: 'no console errors', detail: consoleErrors.join(' | ') })
  checks.push({ ok: pageErrors.length === 0, label: 'no page errors', detail: pageErrors.join(' | ') })
  checks.push({ ok: failedRequests.length === 0, label: 'no failed requests', detail: failedRequests.join(' | ') })
  const failed = checks.some((c) => !c.ok)
  record(p.label, failed ? 'fail' : 'ok', checks)
}

// ---- 4. Nav menu completeness -------------------------------------------------
{
  await page.goto(`${baseURL}/`, { waitUntil: 'networkidle' })
  const links = await page.locator('nav a').evaluateAll((as) =>
    as.map((a) => ({ href: a.getAttribute('href'), label: (a.textContent ?? '').trim() })),
  )
  const expected = [
    { href: '/', label: 'Overview' },
    { href: '/devices', label: 'Devices' },
    { href: '/alerts', label: 'Alerts' },
    { href: '/settings', label: 'Settings' },
  ]
  const checks = expected.map((e) => {
    const hit = links.find((l) => l.href === e.href)
    return { ok: Boolean(hit) && hit.label === e.label, label: `nav has "${e.label}" -> ${e.href}`, detail: hit ? `label="${hit.label}"` : 'missing' }
  })
  // Click every nav item and confirm it navigates.
  for (const e of expected) {
    await page.click(`nav a[href="${e.href}"]`)
    await page.waitForURL((u) => u.pathname === e.href, { timeout: 10_000 }).catch(() => {})
    const ok = new URL(page.url()).pathname === e.href
    checks.push({ ok, label: `click "${e.label}" navigates`, detail: page.url() })
    await page.goBack().catch(() => {})
  }
  record('Nav menu (4 items, click-through)', checks.some((c) => !c.ok) ? 'fail' : 'ok', checks)
}

// ---- 5. Device detail page (click the first table row) -----------------------
{
  await page.goto(`${baseURL}/devices`, { waitUntil: 'networkidle' })
  const rows = await page.locator('tbody tr').count()
  if (rows === 0) {
    record('Device detail page', 'warn', [{ ok: false, label: 'a /devices/[id] link exists', detail: 'no devices in DB yet' }])
  } else {
    // The table navigates by row click (window.location.href), a full document
    // load — waitForURL fires on the URL change, before the new page renders,
    // so wait for load + the heading to actually appear.
    await Promise.all([
      page.waitForURL(/\/devices\/[^/]+$/, { timeout: 10_000 }),
      page.locator('tbody tr').first().click(),
    ])
    await page.waitForLoadState('networkidle')
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 10_000 })
    const href = new URL(page.url()).pathname
    const checks = [
      { ok: /^\/devices\/[^/]+$/.test(href), label: 'row click navigates to /devices/[id]', detail: href },
      { ok: (await page.locator('h1, h2').count()) > 0, label: 'detail heading rendered' },
      { ok: /mac|ipv4|manufacturer|bandwidth/i.test(await page.content()), label: 'device facts visible (F-10/F-04)' },
    ]
    record(`Device detail (${href})`, checks.some((c) => !c.ok) ? 'fail' : 'ok', checks)
  }
}

// ---- 6. API smoke with session cookie ----------------------------------------
{
  const apiPages = ['/api/overview', '/api/devices', '/api/alerts', '/api/settings', '/api/health', '/api/auth/me']
  const checks = []
  for (const api of apiPages) {
    const res = await page.goto(`${baseURL}${api}`).catch(() => null)
    checks.push({ ok: res?.status() === 200, label: `GET ${api} -> 200`, detail: `got ${res?.status()}` })
  }
  record('API endpoints (authenticated)', checks.some((c) => !c.ok) ? 'fail' : 'ok', checks)
}

await authedContext.close()
await browser.close()

// ---- Summary ------------------------------------------------------------------
const fails = report.filter((r) => r.status === 'fail').length
const warns = report.filter((r) => r.status === 'warn').length
console.log(`\n==== UI AUDIT SUMMARY: ${report.length} sections, ${fails} failed, ${warns} warnings ====`)
for (const r of report) {
  const bad = r.checks.filter((c) => !c.ok)
  if (bad.length) console.log(`${r.name}: ${bad.map((c) => c.label).join('; ')}`)
}
process.exit(fails > 0 ? 1 : 0)
