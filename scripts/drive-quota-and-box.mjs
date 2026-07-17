/**
 * Click-through for the daily quota strip and the "Pages per box request"
 * Customize setting. Drives the real app at http://localhost:5173 (start
 * `npx vite` first) with playwright-core + installed Edge. The fake key
 * never reaches a real conversion — its one validation call fails as
 * wrong-key, which is exactly what the strip-visibility check needs.
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

  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  // --- No key stored: the quota strip stays hidden.
  check(
    'quota strip hidden without a key',
    (await page.locator('.ds-quota-strip').count()) === 0,
  )

  // --- Customize: the box-request select renders with the default.
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  const boxSelect = page.getByRole('button', { name: /Pages per box request/ })
  check('box select renders', await boxSelect.isVisible())
  check(
    'box select defaults to 1 page',
    (await boxSelect.textContent())?.includes('1 page (default)') ?? false,
  )
  await boxSelect.click()
  await page.getByRole('option', { name: '4 pages' }).click()
  await page.screenshot({ path: `${OUT}customize-box-select.png` })
  await page.reload()
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  check(
    'box choice persists across reload',
    (await page
      .getByRole('button', { name: /Pages per box request/ })
      .textContent())?.includes('4 pages') ?? false,
  )

  // --- Save a (fake) key: the strip appears at 0 of 400.
  await page.getByRole('button', { name: 'API', exact: true }).first().click()
  await page.getByLabel('Google Gemini API key').fill('AIza-not-a-real-key')
  await page.getByRole('button', { name: 'Check key' }).click()
  await page.locator('.ds-quota-strip').waitFor({ timeout: 15000 })
  check('quota strip appears once a key exists', true)
  const meterText = await page
    .locator('.ds-quota-strip .ds-storage-meter')
    .textContent()
  check(
    'strip reads 0 of 400',
    (meterText?.includes('0 of 400') ?? false) && (meterText?.includes('Gemini free requests today') ?? false),
  )
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${OUT}quota-strip.png` })
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
