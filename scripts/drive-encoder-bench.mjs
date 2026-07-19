/**
 * TEMPORARY: drives the real UI path a phone user will take — open the
 * Diagnostics rail button, press "Run benchmark", wait for every candidate to
 * report. Proves the control is reachable and the results render, which the
 * module-level check cannot. Delete with src/pdf/encoder-bench.ts.
 *
 * Start `npx vite` first, then: node scripts/drive-encoder-bench.mjs
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: /diagnostics/i }).first().click()
  await page.getByRole('heading', { name: 'Image encoder benchmark' }).waitFor({
    timeout: 10_000,
  })

  const button = page.getByRole('button', { name: 'Run benchmark' })
  await button.click()

  // Every candidate reports a line; wait for the button to leave its
  // "Measuring…" state rather than guessing at a duration.
  await page
    .getByRole('button', { name: 'Run benchmark' })
    .waitFor({ state: 'visible', timeout: 180_000 })

  const lines = await page
    .locator('.ds-diagnostics__row')
    .filter({ hasText: 'ms/page' })
    .allInnerTexts()

  console.log('\nRendered in the app:\n')
  for (const line of lines) console.log(`  ${line}`)
  console.log()

  if (lines.length < 2) {
    console.error(`FAIL: expected at least 2 result lines, got ${lines.length}`)
    process.exitCode = 1
  } else {
    console.log(`PASS: benchmark reachable from the Diagnostics panel, ${lines.length} results rendered`)
  }
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await browser.close()
}
