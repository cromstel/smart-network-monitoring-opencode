import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const baseURL = process.argv[2] ?? 'http://localhost:9000'
const theme = process.argv[3] ?? 'light'

const envLocal = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '')
const envFrom = (t, k) => {
  const raw = t.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
  if (raw === undefined) return undefined
  // .env values may be quoted; the quotes are syntax, not part of the value.
  return raw.replace(/^["'](.*)["']$/, '$1')
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } })
await ctx.addInitScript((t) => {
  try {
    localStorage.setItem('hnm-theme', t)
  } catch {}
}, theme)
const page = await ctx.newPage()

const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`))

// Sign in through the API rather than the form: submitting the form before
// React hydrates makes the browser do a native GET, which puts the password
// in the URL and in the access log. The login form itself is covered by
// scripts/ui-audit.mjs.
const login = await page.request.post(`${baseURL}/api/auth/login`, {
  data: {
    email: envFrom(envLocal, 'ADMIN_EMAIL'),
    password: envFrom(envLocal, 'ADMIN_PASSWORD'),
  },
})
if (!login.ok()) {
  console.log(`LOGIN FAILED ${login.status()}: ${await login.text()}`)
  await browser.close()
  process.exit(1)
}
console.log('logged in')

// The theme is driven by the *authoritative server setting*, not by
// localStorage: ThemeSync reconciles the two, and the server value wins. So
// the audit sets the setting itself, exactly as the settings page does.
const setTheme = await page.request.patch(`${baseURL}/api/settings`, {
  data: { theme },
})
if (!setTheme.ok()) console.log(`theme set failed ${setTheme.status()}: ${await setTheme.text()}`)
else console.log(`theme set to ${theme}`)

for (const p of ['/', '/devices', '/alerts', '/settings']) {
  await page.goto(`${baseURL}${p}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `page-${theme}-${p === '/' ? 'overview' : p.slice(1)}.png` })

  // Contrast audit. Translucent backgrounds are composited over whatever is
  // behind them — comparing a label against `rgba(34,197,94,0.2)` as if it
  // were opaque reports a false failure for every tinted badge.
  const low = await page.evaluate(() => {
    const parse = (c) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number)
      return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 }
    }
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    })
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const bgOf = (el) => {
      const layers = []
      let n = el
      while (n && n !== document.documentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor)
        if (bg.a > 0) {
          layers.push(bg)
          if (bg.a === 1) break
        }
        n = n.parentElement
      }
      layers.push(parse(getComputedStyle(document.documentElement).backgroundColor))
      // Composite from the bottom up.
      let acc = layers[layers.length - 1]
      for (let i = layers.length - 2; i >= 0; i--) acc = over(layers[i], acc)
      return acc
    }
    const out = []
    for (const el of document.querySelectorAll('input, button, a, label, span, p, h1, h2, td, th')) {
      const text = (el.textContent ?? '').trim()
      const isInput = el.tagName === 'INPUT'
      if (!text && !isInput) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const fg = parse(cs.color)
      const bg = bgOf(el)
      const solidFg = fg.a < 1 ? over(fg, bg) : fg
      const l1 = lum(solidFg)
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      if (ratio < 2.5) {
        out.push(
          `${el.tagName} "${text.slice(0, 25)}" fg=${cs.color} bg=rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}) ratio=${ratio.toFixed(2)}`
        )
      }
    }
    return out
  })
  if (low.length) problems.push(`${p} low contrast:\n    ` + low.join('\n    '))
  const themeClass = await page.evaluate(() => document.documentElement.className)
  if (themeClass !== 'light' && theme === 'light') {
    problems.push(`${p} expected html.light, got "${themeClass}"`)
  }
}

console.log(problems.length ? problems.join('\n') : `NO PROBLEMS (theme=${theme})`)

// Put the account's theme back the way it was found.
await page.request.patch(`${baseURL}/api/settings`, { data: { theme: 'dark' } })
await browser.close()
