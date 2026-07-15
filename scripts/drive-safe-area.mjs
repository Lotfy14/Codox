/**
 * Safe-area verification: on a phone-width viewport, the mobile header
 * (.ds-sidebar) and bottom tab bar (.ds-mobile-nav) must inset by the
 * system-bar/cutout amount. Android reports env(safe-area-inset-*) as 0,
 * so the CSS reads --safe-area-inset-* (injected by Capacitor's SystemBars).
 * This simulates that injection and checks the padding grows accordingly.
 * Start `npx vite --port 5173` first. Uses playwright-core + installed Edge.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const TOP = 47 // px, e.g. a camera-cutout status bar
const BOTTOM = 34 // px, e.g. a gesture nav bar

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const px = (v) => parseFloat(v)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  // Phone width (< 1024px triggers the mobile layout) with a tall viewport.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(BASE)
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  const read = () =>
    page.evaluate(() => {
      const header = document.querySelector('.ds-sidebar')
      const nav = document.querySelector('.ds-mobile-nav')
      const cs = (el) => (el ? getComputedStyle(el) : null)
      return {
        headerPadTop: cs(header)?.paddingTop ?? null,
        navPadBottom: cs(nav)?.paddingBottom ?? null,
      }
    })

  // Baseline: no injected insets (env resolves to 0 on desktop). Padding is
  // the plain fallback (max(space-3, 0) = 12px top; max(space-1, 0) = 4px bottom).
  const before = await read()
  check('header + nav render on mobile', before.headerPadTop != null && before.navPadBottom != null,
    JSON.stringify(before))

  // Simulate Capacitor SystemBars injecting the real insets as CSS variables.
  await page.evaluate(({ top, bottom }) => {
    const r = document.documentElement.style
    r.setProperty('--safe-area-inset-top', `${top}px`)
    r.setProperty('--safe-area-inset-bottom', `${bottom}px`)
  }, { top: TOP, bottom: BOTTOM })

  const after = await read()
  check('header clears the camera (padding-top >= inset-top)',
    px(after.headerPadTop) >= TOP,
    `${before.headerPadTop} -> ${after.headerPadTop}, inset ${TOP}`)
  check('bottom nav clears the home bar (padding-bottom >= inset-bottom)',
    px(after.navPadBottom) >= BOTTOM,
    `${before.navPadBottom} -> ${after.navPadBottom}, inset ${BOTTOM}`)
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL GREEN')
process.exit(failed.length ? 1 : 0)
