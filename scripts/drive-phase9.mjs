/**
 * Phase 9 click-through: declaration removed, split-button export, AI dialog.
 * Drives the real app at http://127.0.0.1:5173 (start `npx vite` first) with
 * playwright-core + installed Edge — no browser download, no real Gemini
 * calls (the AI dialog is inspected, never confirmed).
 * Screenshots land in scripts/out/ (gitignored).
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

function minimalPdf(label) {
  const content = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    `(${label}) Tj`,
    '0 -30 Td',
    '(A. Three    B. Four) Tj',
    'ET',
  ].join('\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n%1234\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

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

  // ---- 1. Upload screen: no declaration, always-visible optional key zone.
  await page.goto(BASE)
  const coachmark = page.getByRole('button', { name: 'Dismiss API key tip' })
  if (await coachmark.isVisible().catch(() => false)) await coachmark.click()

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'Drive Exam.pdf',
      mimeType: 'application/pdf',
      buffer: minimalPdf('What is two plus two?'),
    })
  await page.getByText('1 PDF ready').waitFor({ timeout: 30_000 })

  check(
    'declaration question is gone',
    (await page.getByText('Where are the answers?').count()) === 0,
  )
  check(
    'optional key-zone hint is visible',
    await page.getByText(/Optional — have a separate answer-key PDF/).isVisible(),
  )
  check(
    'key drop zone is visible without any declaration',
    await page.locator('.ds-key-file-slot input[type="file"]').count() === 1,
  )
  check(
    'start button is enabled with no key file',
    !(await page.getByRole('button', { name: 'Start converting' }).isDisabled()),
  )
  await page.screenshot({ path: `${OUT}upload.png`, fullPage: true })

  // ---- 2. Seed a finished run directly in IndexedDB, reload → done panel.
  await page.evaluate(async () => {
    const row = (id, fill = {}) => ({
      id,
      group_id: '',
      topic: 'Surgery',
      subtopic: '',
      year: '',
      question: `Question ${id}?`,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correct_index: '',
      image_urls: [],
      needs_review: 'no_answer_key',
      ...fill,
    })
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('codox')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction(['runs', 'runArtifacts'], 'readwrite')
    const now = Date.now()
    tx.objectStore('runs').put({
      id: 'run-drive',
      jobId: 'current',
      pdfId: 'pdf-drive',
      fileName: 'Drive Exam.pdf',
      status: 'done',
      step: 'audit',
      flaggedRows: 1,
      pageCount: 1,
      pagesRendered: 1,
      createdAt: now,
      updatedAt: now,
    })
    tx.objectStore('runArtifacts').put({
      id: 'artifact-drive',
      runId: 'run-drive',
      kind: 'merged-rows',
      json: [row('1', { correct_index: '2', needs_review: '' }), row('2')],
      createdAt: now,
    })
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload()
  await page.getByText(/needs? your eyes|stopped|was read cleanly/).first().waitFor({ timeout: 15_000 })
  const coachmarkAgain = page.getByRole('button', { name: 'Dismiss API key tip' })
  if (await coachmarkAgain.isVisible().catch(() => false)) await coachmarkAgain.click()

  // ---- 3. Split button: chevron opens the two-variant menu.
  const chevron = page.getByRole('button', { name: 'More export options' })
  check('split-button chevron is present', (await chevron.count()) > 0)
  await chevron.first().click()
  const noAnswersItem = page.getByRole('menuitem', { name: /Export without answers/ })
  const aiItem = page.getByRole('menuitem', { name: /Export with AI answers/ })
  check('menu shows "without answers"', await noAnswersItem.isVisible())
  check('menu shows "with AI answers"', await aiItem.isVisible())
  await page.screenshot({ path: `${OUT}export-menu.png` })

  // Keyboard: Escape closes, Enter on the chevron reopens.
  await page.keyboard.press('Escape')
  await chevron.first().focus()
  await page.keyboard.press('Enter')
  check(
    'menu opens from the keyboard',
    await page.getByRole('menuitem', { name: /Export without answers/ }).isVisible(),
  )

  // ---- 4. AI dialog: scope + threshold radios, quota note, provenance text.
  await page.getByRole('menuitem', { name: /Export with AI answers/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Export with AI answers' })
  await dialog.waitFor({ timeout: 10_000 })
  check(
    'provenance warning is shown',
    await dialog.getByText(/not from your document/).isVisible(),
  )
  const radios = dialog.getByRole('radio')
  check('six choice radios (3 scope + 3 threshold)', (await radios.count()) === 6)
  check(
    'honest quota note counts one request for the one blank row',
    await dialog.getByText('About 1 Gemini request against your key.').isVisible(),
  )
  await dialog.getByRole('radio', { name: /Every question/ }).click()
  check(
    'scope change re-estimates quota (2 rows → still 1 chunk)',
    await dialog.getByText('About 1 Gemini request against your key.').isVisible(),
  )
  check(
    'confirm button is labelled Answer and export',
    await dialog.getByRole('button', { name: 'Answer and export' }).isVisible(),
  )
  await page.screenshot({ path: `${OUT}ai-dialog.png` })
  await page.keyboard.press('Escape')

  await context.close()
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(failed.length === 0 ? '\nALL GREEN' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
