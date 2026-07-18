/**
 * Matching-questions setting click-through: the Customize tab's new
 * "Matching questions" panel defaults to Split, each choice selects, and the
 * choice survives a reload (it is read at conversion drive time).
 * Drives the real app at http://localhost:5173 (start `npx vite` first)
 * with playwright-core + installed Edge — no real Gemini calls.
 * Screenshots land in scripts/out/ (gitignored).
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

const checks = []
function check(name, pass) {
  checks.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await context.newPage()
  await page.goto(BASE)

  const dismissCoachmark = async () => {
    await page
      .getByRole('button', { name: 'Dismiss API key tip' })
      .click({ timeout: 5000 })
      .catch(() => {})
  }
  const openCustomize = async () => {
    await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  }
  await dismissCoachmark()
  await openCustomize()

  const skip = page.getByRole('radio', { name: /Leave them out/ })
  const split = page.getByRole('radio', { name: /Split into single questions/ })

  check('matching panel renders', await split.isVisible())
  check('defaults to Split', (await split.getAttribute('aria-checked')) === 'true')
  check(
    'no "keep as printed" mode is offered',
    !(await page
      .getByRole('radio', { name: /Keep as they are/ })
      .isVisible()
      .catch(() => false)),
  )

  await skip.click()
  check('Leave them out selects', (await skip.getAttribute('aria-checked')) === 'true')
  check(
    'the modes are mutually exclusive',
    (await split.getAttribute('aria-checked')) === 'false',
  )
  await page.screenshot({ path: `${OUT}matching-mode.png` })

  await page.reload()
  await dismissCoachmark()
  await openCustomize()
  check('choice persists across reload', (await skip.getAttribute('aria-checked')) === 'true')
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
