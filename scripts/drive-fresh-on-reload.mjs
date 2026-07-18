/**
 * Fresh-on-reload: a finished conversion must not stick on the Convert
 * screen. Seed a done run under the current job, reload, and confirm the
 * Convert tab opens clean (drop zone, no done screen) while the finished
 * work is retired to History — reachable and exportable. A second scenario
 * confirms an in-flight (running) batch is left to resume, not archived.
 * Drives the real app at http://localhost:5173 (start `npx vite` first)
 * with playwright-core + installed Edge. Screenshots in scripts/out/.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

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

/** Seed one run (given status) plus its merged-rows under the current job. */
async function seedRun(page, status) {
  await page.evaluate(async (runStatus) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('codox')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction(['runs', 'runArtifacts'], 'readwrite')
    const now = Date.now()
    tx.objectStore('runs').put({
      id: 'run-seed',
      jobId: 'current',
      pdfId: 'pdf-seed',
      fileName: 'Seed Exam.pdf',
      status: runStatus,
      step: runStatus === 'done' ? 'audit' : 'worker',
      flaggedRows: runStatus === 'done' ? 1 : 0,
      pageCount: 1,
      pagesRendered: 1,
      createdAt: now,
      updatedAt: now,
    })
    tx.objectStore('runArtifacts').put({
      id: 'artifact-seed',
      runId: 'run-seed',
      kind: 'merged-rows',
      json: [
        {
          id: '1', group_id: '', topic: '', subtopic: '', year: '',
          question: 'Seeded question one?',
          options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
          correct_index: '', image_urls: [], needs_review: 'no_answer_key',
        },
      ],
      createdAt: now,
    })
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, status)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  const page = await context.newPage()

  const dismissCoachmark = async () => {
    await page
      .getByRole('button', { name: 'Dismiss API key tip' })
      .click({ timeout: 5000 })
      .catch(() => {})
  }

  // ---------------------------------------------------------------------
  // Scenario A: a FINISHED (done) batch is archived on reload.
  // ---------------------------------------------------------------------
  await page.goto(BASE)
  await dismissCoachmark()

  // Uploading one exam creates the current job the seeded run hangs off.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Seed Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('What is two plus two?'),
  })
  await page.getByText('1 PDF ready').waitFor({ timeout: 30_000 })

  await seedRun(page, 'done')

  // First reload after seeding: the done screen would normally show here.
  // With fresh-on-reload, startup archives it and Convert opens clean.
  await page.reload()
  await dismissCoachmark()
  const dropZone = page.getByText('Drop PDFs here')
  await dropZone.first().waitFor({ timeout: 15_000 }).catch(() => {})

  const doneVisible = await page
    .getByText(/answers need your eyes|everything else is ready|questions$/)
    .first()
    .isVisible()
    .catch(() => false)
  const dropVisible = await dropZone.first().isVisible().catch(() => false)
  check('Convert opens clean after reload (no done screen)', !doneVisible)
  check('Convert opens clean after reload (empty drop zone shown)', dropVisible)
  await page.screenshot({ path: `${OUT}fresh-convert-after-reload.png`, fullPage: true })

  // The finished work is retired to History, still listed and reviewable.
  await page.getByRole('tab', { name: 'History' }).click().catch(async () => {
    await page.getByRole('button', { name: 'History' }).click()
  })
  const seedCard = page.getByRole('listitem').filter({ hasText: 'Seed Exam.pdf' })
  check('finished conversion appears in History', await seedCard.first().isVisible().catch(() => false))
  await page.screenshot({ path: `${OUT}history-has-archived.png`, fullPage: true })

  // Confirm nothing lingers under the live "current" job in the DB.
  const currentRunCount = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('codox')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const runs = await new Promise((resolve, reject) => {
      const req = db.transaction('runs').objectStore('runs').getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return runs.filter((r) => r.jobId === 'current').length
  })
  check('no runs remain under the current job', currentRunCount === 0)

  // ---------------------------------------------------------------------
  // Scenario B: an in-flight (running) batch is NOT archived — it resumes.
  // Fresh context = empty IndexedDB.
  // ---------------------------------------------------------------------
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  const page2 = await context2.newPage()
  const dismiss2 = async () => {
    await page2.getByRole('button', { name: 'Dismiss API key tip' }).click({ timeout: 5000 }).catch(() => {})
  }
  await page2.goto(BASE)
  await dismiss2()
  await page2.locator('input[type="file"]').first().setInputFiles({
    name: 'Seed Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('Running exam?'),
  })
  await page2.getByText('1 PDF ready').waitFor({ timeout: 30_000 })
  await seedRun(page2, 'running')

  // Read the run's jobId right after the startup effect would have fired.
  await page2.reload()
  await dismiss2()
  await page2.waitForTimeout(1500)
  const runJobIdAfterReload = await page2.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('codox')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const run = await new Promise((resolve, reject) => {
      const req = db.transaction('runs').objectStore('runs').get('run-seed')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return run?.jobId
  })
  // The resumer owns it: it stays under 'current' (the missing source PDF
  // then flips it to 'stopped', but crucially it is NOT moved to history).
  check(
    'in-flight batch is not archived on reload (stays under current)',
    runJobIdAfterReload === 'current',
  )

  await context2.close()
  await context.close()
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(failed.length === 0 ? '\nALL GREEN' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
