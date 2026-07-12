/**
 * Phase-5 verification drive: exercises the real PDF pipeline and the
 * Convert screen in a headless browser (Edge channel — no download).
 * Prereq: `npm run dev` on port 5173. Run: `node scripts/drive-phase5.mjs`
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:5173'
const OUT = resolve('scripts', 'out')

/** Hand-rolled minimal PDF (ASCII only, so offsets = string lengths). */
function makeTestPdf(pageTexts) {
  const objs = []
  const kids = []
  let next = 4 // 1 = catalog, 2 = pages, 3 = font
  const pageObjs = pageTexts.map(() => {
    const ids = { page: next, content: next + 1 }
    kids.push(`${next} 0 R`)
    next += 2
    return ids
  })
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageTexts.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pageTexts.forEach((text, i) => {
    const { page, content } = pageObjs[i]
    objs[page] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`
    objs[content] = { stream: `BT /F1 24 Tf 72 700 Td (${text}) Tj ET` }
  })

  let out = '%PDF-1.4\n'
  const offsets = []
  for (let n = 1; n < next; n++) {
    offsets[n] = out.length
    const body = objs[n]
    out +=
      typeof body === 'string'
        ? `${n} 0 obj\n${body}\nendobj\n`
        : `${n} 0 obj\n<< /Length ${body.stream.length} >>\nstream\n${body.stream}\nendstream\nendobj\n`
  }
  const xrefStart = out.length
  out += `xref\n0 ${next}\n0000000000 65535 f \n`
  for (let n = 1; n < next; n++) {
    out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

mkdirSync(OUT, { recursive: true })
const pdfPath = resolve(OUT, 'spike-3page.pdf')
writeFileSync(
  pdfPath,
  makeTestPdf([
    'Codox spike page one',
    'Codox spike page two',
    'Codox spike page three',
  ]),
)
const fakePdfPath = resolve(OUT, 'fake.pdf')
writeFileSync(fakePdfPath, 'this is a text file wearing a pdf extension')

// 20 pages crosses the every-8-pages WASM re-init boundary twice.
const longPdfPath = resolve(OUT, 'spike-20page.pdf')
writeFileSync(
  longPdfPath,
  makeTestPdf(
    Array.from({ length: 20 }, (_, i) => `Codox reinit check page ${i + 1}`),
  ),
)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext()
const page = await context.newPage()
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[console]', message.text())
})

try {
  // ---------- 1. Spike surface: the real pipeline end-to-end ----------
  await page.goto(`${BASE}/?pdfspike=1`)
  await page.setInputFiles('[data-testid="spike-input"]', pdfPath)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="spike-status"]')?.textContent ===
      'Done.',
    null,
    { timeout: 90_000 },
  )
  const summary = await page.textContent('[data-testid="spike-summary"]')
  assert.match(summary, /3 pages/, `spike summary says 3 pages (got: ${summary})`)
  assert.match(summary, /failures: 0/, `spike summary has no failures (got: ${summary})`)

  const rows = await page.$$eval('[data-testid="spike-row"]', (trs) =>
    trs.map((tr) => Array.from(tr.children).map((td) => td.textContent)),
  )
  assert.equal(rows.length, 3, 'one stats row per page')
  for (const [pageNo, , jpegKB, textChars] of rows) {
    assert.ok(Number(jpegKB) > 0, `page ${pageNo}: JPEG has bytes (${jpegKB} KB)`)
    assert.ok(
      Number(textChars) > 0,
      `page ${pageNo}: pdf.js text layer extracted (${textChars} chars)`,
    )
  }
  await page.screenshot({ path: resolve(OUT, 'spike.png'), fullPage: true })
  console.log('spike surface: OK —', summary)

  // Same surface, 20 pages: proves the WASM re-init every 8 pages keeps
  // rendering correctly past the boundaries (pages 9 and 17).
  await page.setInputFiles('[data-testid="spike-input"]', longPdfPath)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="spike-status"]')?.textContent ===
      'Done.',
    null,
    { timeout: 180_000 },
  )
  const longSummary = await page.textContent('[data-testid="spike-summary"]')
  assert.match(longSummary, /20 pages/, `20-page summary (got: ${longSummary})`)
  assert.match(longSummary, /failures: 0/, `no failures across re-inits (got: ${longSummary})`)
  const longRows = await page.$$eval('[data-testid="spike-row"]', (trs) =>
    trs.map((tr) => Number(tr.children[2].textContent)),
  )
  assert.equal(longRows.length, 20)
  assert.ok(
    longRows.every((kb) => kb > 0),
    'every page past the re-init boundaries produced a JPEG',
  )
  console.log('reinit path: OK —', longSummary)

  // ---------- 2. Convert screen ----------
  // Boot once so Dexie creates the schema, then mark first-run done.
  await page.goto(BASE)
  await page.waitForSelector('#root :first-child')
  await page.evaluate(
    () =>
      new Promise((resolvePut, rejectPut) => {
        const request = indexedDB.open('codox')
        request.onerror = () => rejectPut(request.error)
        request.onsuccess = () => {
          const database = request.result
          const tx = database.transaction('meta', 'readwrite')
          tx.objectStore('meta').put({
            key: 'firstRunCompletedAt',
            value: new Date().toISOString(),
          })
          tx.oncomplete = () => {
            database.close()
            resolvePut(undefined)
          }
          tx.onerror = () => rejectPut(tx.error)
        }
      }),
  )
  await page.reload()
  await page.waitForSelector('#convert-heading')

  // Home stage: drop the real PDF → file row appears with its size.
  await page.setInputFiles('input[type="file"]', pdfPath)
  await page.waitForSelector('.ds-file-row')
  const rowText = await page.textContent('.ds-file-row')
  assert.match(rowText, /spike-3page\.pdf/, 'file row shows the PDF name')
  const startNote = await page.textContent('.convert-start-note')
  assert.match(startNote, /3 pages/, `start note counts 3 pages (got: ${startNote})`)

  // A disguised non-PDF produces the canonical note and no row.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fakePdfPath)
  await page.waitForSelector('.convert-inline-note--danger')
  const noteText = await page.textContent('.convert-inline-note--danger')
  assert.match(noteText, /Only PDF files work here/, 'not-a-PDF note shown')
  assert.equal(
    await page.locator('.ds-file-row').count(),
    1,
    'the fake PDF was not stored',
  )

  // Declaration → separate key file → the key-file slot appears.
  await page.getByRole('button', { name: /Inside the PDFs/ }).click()
  await page
    .getByRole('option', { name: 'In a separate answer key file' })
    .click()
  await page.waitForSelector('.convert-key-file-slot')

  // Everything survives a reload (IndexedDB persistence).
  await page.reload()
  await page.waitForSelector('.ds-file-row')
  assert.equal(await page.locator('.ds-file-row').count(), 1)
  await page.waitForSelector('.convert-key-file-slot')
  const reloadedStartNote = await page.textContent('.convert-start-note')
  assert.match(reloadedStartNote, /3 pages/, 'page count persisted')
  assert.ok(
    await page.locator('button', { hasText: 'Start converting' }).isDisabled(),
    'Start stays disabled in Phase 5',
  )
  await page.screenshot({ path: resolve(OUT, 'convert.png'), fullPage: true })
  console.log('convert screen: OK — intake, notes, declaration, persistence')

  console.log('PHASE5 DRIVE: ALL GREEN')
} finally {
  await browser.close()
}
