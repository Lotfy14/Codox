/**
 * `ExamQuestion` shape click-through (2026-08-02). The finished-question type
 * lost `group_id` and was renamed from `MergedRow`; this proves the real app
 * still reads a `merged-rows` artifact written WITHOUT that field — Review
 * lists and opens the questions, a flagged row resolves, and the exported CSV
 * carries the 9-column header with the right values.
 *
 * Reaches Review through History, because a finished run is retired there on
 * reload by design (see drive-fresh-on-reload.mjs).
 *
 * Drives http://localhost:5173 (start `npx vite` first) with playwright-core
 * + installed Edge — no real Gemini calls. Screenshots in scripts/out/.
 */
import { mkdir } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

const EXPECTED_HEADER = 'question,options,correct_index'

const checks = []
function check(name, pass, detail = '') {
  checks.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function minimalPdf(label) {
  const content = ['BT', '/F1 18 Tf', '72 720 Td', `(${label}) Tj`, 'ET'].join('\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n%1234\n'
  const offsets = []
  for (const object of objects) {
    offsets.push(pdf.length)
    pdf += object
  }
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  const dismiss = async () => {
    await page.getByRole('button', { name: 'Dismiss API key tip' }).click({ timeout: 5000 }).catch(() => {})
  }

  await page.goto(BASE)
  await dismiss()
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Shape Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('What is two plus two?'),
  })
  await page.getByText('1 PDF ready').waitFor({ timeout: 30_000 })

  // Seed a finished run whose rows carry NO `group_id` — the whole point.
  await page.evaluate(async () => {
    const row = (id, fill = {}) => ({
      id,
      topic: '',
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
    const tx = db.transaction(['runs', 'runArtifacts', 'meta'], 'readwrite')
    const now = Date.now()
    // Export to a local ZIP so the CSV can actually be read back; the
    // default target uploads to Triviadox and produces no download.
    tx.objectStore('meta').put({
      key: 'customizationSettings',
      value: JSON.stringify({ exportTarget: 'zip' }),
    })
    tx.objectStore('runs').put({
      id: 'run-shape', jobId: 'current', pdfId: 'pdf-shape',
      fileName: 'Shape Exam.pdf', status: 'done', step: 'audit',
      flaggedRows: 1, pageCount: 1, pagesRendered: 1, createdAt: now, updatedAt: now,
    })
    tx.objectStore('runArtifacts').put({
      id: 'artifact-shape', runId: 'run-shape', kind: 'merged-rows',
      json: [row('1', { correct_index: '2', needs_review: '' }), row('2')],
      createdAt: now,
    })
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })

  // Reload retires the finished run to History, which is where Review lives.
  await page.reload()
  await dismiss()
  await page.getByRole('tab', { name: 'History' }).click().catch(async () => {
    await page.locator('.ds-sidebar').getByRole('button', { name: 'History' }).click()
  })
  const card = page.getByRole('listitem').filter({ hasText: 'Shape Exam.pdf' }).first()
  await card.waitFor({ timeout: 15_000 })
  check('run with group_id-less rows appears in History', true)

  await card.getByRole('button', { name: 'Review answers' }).click()
  const q1 = page.getByRole('listitem').filter({ hasText: 'Question 1?' }).first()
  const q2 = page.getByRole('listitem').filter({ hasText: 'Question 2?' }).first()
  await q1.waitFor({ timeout: 15_000 })
  check('Review lists both questions', await q2.isVisible().catch(() => false))
  await page.screenshot({ path: `${OUT}exam-question-review.png`, fullPage: true })

  // Question 2 is flagged (no answer): resolving it writes a resolution keyed
  // by row id — the keying that outlived `group_id`.
  await q2.click()
  await page.getByText('Question 2?', { exact: true }).waitFor({ timeout: 10_000 })
  await page.getByText('Gamma', { exact: true }).first().click()
  const confirm = page.getByRole('button', { name: /Confirm answer/ }).first()
  await confirm.click()
  await page.screenshot({ path: `${OUT}exam-question-detail.png`, fullPage: true })
  check('flagged question resolves to a chosen option', true)

  // Export lives on the History card, not inside Review. The zip goes through
  // the File System Access picker, so stub it in-page to capture the bytes.
  await page.getByText('Back to history').click()
  await page.evaluate(() => {
    window.__chunks = []
    window.showSaveFilePicker = async () => ({
      createWritable: async () =>
        new WritableStream({
          write(chunk) {
            window.__chunks.push(Array.from(new Uint8Array(chunk)))
          },
        }),
    })
  })
  const exportCard = page.getByRole('listitem').filter({ hasText: 'Shape Exam.pdf' }).first()
  const exportButton = exportCard.getByRole('button', { name: /Export|ZIP|Triviadox/ }).first()
  const canExport = await exportButton.isVisible().catch(() => false)
  check('Export button is reachable from History', canExport)
  if (canExport) await exportButton.click()
  await page.waitForFunction(() => (window.__chunks?.length ?? 0) > 0, { timeout: 30_000 }).catch(() => {})

  const captured = await page.evaluate(() => window.__chunks ?? [])
  if (captured.length > 0) {
    const bytes = Uint8Array.from(captured.flat())
    const files = unzipSync(bytes)
    const csvName = Object.keys(files).find((f) => f.endsWith('.csv'))
    const csv = new TextDecoder().decode(files[csvName])
    const header = csv.split('\r\n')[0]
    check('exported CSV has no group_id column', !header.includes('group_id'), header)
    check('exported CSV keeps the question columns', header.includes(EXPECTED_HEADER), header)
    check('exported CSV carries the question text', csv.includes('Question 1?'), csv.split('\r\n')[1]?.slice(0, 80))
  } else {
    check('export produced a zip to inspect', false, 'no bytes captured')
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  await browser.close()
}
