/**
 * TEMPORARY: runs the real on-device encoder benchmark (src/pdf/encoder-bench.ts)
 * in a desktop browser, both to prove the module works before it ships and to
 * capture the desktop baseline the phone's numbers get compared against.
 * Delete with encoder-bench.ts once the encoder choice is settled.
 *
 * Start `npx vite` first, then: node scripts/verify-encoder-bench.mjs
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

// Headless Edge appears to throttle WASM: it measured MozJPEG at 741 ms/page
// against a real phone's 331 ms. Set BENCH_HEADED=1 for a representative
// desktop number.
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: process.env.BENCH_HEADED !== '1',
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const results = await page.evaluate(async () => {
    const { benchmarkEncoders, formatEncoderResult } = await import(
      '/src/pdf/encoder-bench.ts'
    )
    const raw = await benchmarkEncoders()
    return raw.map((r) => ({ ...r, line: formatEncoderResult(r) }))
  })

  console.log('\nDesktop baseline:\n')
  for (const r of results) console.log(`  ${r.line}`)
  console.log()

  const failures = []
  if (results.length < 2) failures.push('expected at least 2 candidates')
  const measured = results.filter((r) => r.msPerPage !== null)
  if (measured.length === 0) failures.push('no candidate produced a timing')
  for (const r of measured) {
    if (r.kb < 20) failures.push(`${r.name}: suspiciously small output ${r.kb} KB`)
    if (r.msPerPage <= 0) failures.push(`${r.name}: nonsensical timing`)
  }

  if (failures.length > 0) {
    console.error('FAIL: ' + failures.join('; '))
    process.exitCode = 1
  } else {
    console.log(`PASS: ${measured.length} encoders measured`)
  }
} finally {
  await browser.close()
}
