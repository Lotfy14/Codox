/**
 * Edit-mode click-through: the review detail's Edit button opens the row
 * editor; question text, options (add/remove + correct mark), topic,
 * subtopic and year edits save, survive a reload, and reach the exported
 * CSV — while the stored merged-rows artifact stays pristine.
 * Drives the real app at http://127.0.0.1:5173 (start `npx vite` first)
 * with playwright-core + installed Edge. Screenshots in scripts/out/.
 */
import { mkdir } from 'node:fs/promises'
import { unzipSync } from 'fflate'
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

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  const page = await context.newPage()

  await page.goto(BASE)
  const dismissCoachmark = async () => {
    await page
      .getByRole('button', { name: 'Dismiss API key tip' })
      .click({ timeout: 5000 })
      .catch(() => {})
  }
  await dismissCoachmark()

  // Uploading one exam creates the current job the seeded run hangs off.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Drive Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('What is two plus two?'),
  })
  await page.getByText('1 PDF ready').waitFor({ timeout: 30_000 })

  // Seed a finished two-question run directly in IndexedDB.
  await page.evaluate(async () => {
    const row = (id, fill = {}) => ({
      id,
      group_id: '',
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
  await page.getByText('2 questions').waitFor({ timeout: 15_000 })
  await dismissCoachmark()

  // ---- 1. Open question 1, enter edit mode.
  await page.getByRole('listitem').filter({ hasText: 'Question 1?' }).click()
  const editButton = page.getByRole('button', { name: 'Edit (E)' })
  check('detail view has an Edit button', await editButton.isVisible())
  await editButton.click()
  const questionField = page.getByLabel('Question text')
  await questionField.waitFor({ timeout: 5_000 })
  check('editor opens with the question text', (await questionField.inputValue()) === 'Question 1?')
  await page.screenshot({ path: `${OUT}edit-mode-open.png`, fullPage: true })

  // ---- 2. Edit question + options: reword B, remove A (answer shifts).
  await questionField.fill('Edited question one?')
  await page.getByLabel('Option B text').fill('Beta prime')
  check(
    'extracted answer (C = Gamma) is pre-marked correct',
    await page.getByRole('radio', { name: 'Option C is correct' }).isChecked(),
  )
  await page.getByRole('button', { name: 'Remove option A' }).click()
  check(
    'answer follows its option after a removal (now B)',
    await page.getByRole('radio', { name: 'Option B is correct' }).isChecked(),
  )
  await page.screenshot({ path: `${OUT}edit-mode-changed.png`, fullPage: true })
  await page.getByRole('button', { name: 'Save changes' }).click()

  const heading = page.locator('.review__question h3')
  await heading.filter({ hasText: 'Edited question one?' }).waitFor({ timeout: 5_000 })
  check('saved question text shows in the detail view', true)
  check('Edited badge shows on the question', await page.getByText('Edited', { exact: true }).isVisible())
  check('removed option is gone', (await page.getByRole('radio', { name: /Alpha/ }).count()) === 0)
  check('reworded option shows', await page.getByRole('radio', { name: /Beta prime/ }).isVisible())
  await page.screenshot({ path: `${OUT}edit-saved.png`, fullPage: true })

  // ---- 3. Question 2: set topic/subtopic/year in the editor.
  await page.getByRole('button', { name: 'Next (→)' }).click()
  await page.getByRole('button', { name: 'Edit (E)' }).click()
  await page.getByLabel('Question text').waitFor({ timeout: 5_000 })
  await page.getByLabel('Topic', { exact: true }).fill('Surgery')
  await page.getByLabel('Subtopic', { exact: true }).fill('Hernia')
  await page.getByLabel('Year', { exact: true }).fill('2023')
  // Mark an answer too, so the flag resolves through the editor.
  await page.getByRole('radio', { name: 'Option D is correct' }).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.locator('.review__question h3').filter({ hasText: 'Question 2?' }).waitFor()

  // ---- 4. Edits survive a reload (IndexedDB artifact, not view state).
  await page.reload()
  await page.getByText('2 questions').waitFor({ timeout: 15_000 })
  await dismissCoachmark()
  check(
    'edited question text survives a reload (list view)',
    await page.getByText('Edited question one?').isVisible(),
  )

  // ---- 5. Export: edits reach the CSV; merged-rows stays pristine.
  // The native save dialog cannot be automated headless — stub the picker
  // and capture the zip bytes it writes (same pattern as drive-save-picker).
  await page.evaluate(() => {
    window.__zipParts = []
    window.showSaveFilePicker = async () => ({
      createWritable: async () =>
        new WritableStream({
          write(chunk) {
            window.__zipParts.push(Array.from(new Uint8Array(chunk)))
          },
        }),
    })
  })
  await page.getByRole('button', { name: 'Export bundle' }).first().click()
  await page.getByText(/lives safely outside Codox/).waitFor({ timeout: 15_000 })
  const zipParts = await page.evaluate(() => window.__zipParts)
  const unzipped = unzipSync(new Uint8Array(zipParts.flat()))
  const csvBytes = unzipped['Drive Exam Cx/Drive Exam Cx.csv']
  check('export zip contains the bundle CSV', csvBytes !== undefined)
  const csv = new TextDecoder().decode(csvBytes.subarray(3))
  const lines = csv.trimEnd().split('\r\n')
  check(
    'edited topic/year force their columns',
    lines[0] === 'topic,subtopic,year,question,options,correct_index,image_url',
  )
  check('row 1 exports the edited question', lines[1].includes('Edited question one?'))
  check('row 1 exports the edited options without Alpha', !lines[1].includes('Alpha'))
  check('row 1 answer index shifted with the removal (2 → 1)', lines[1].includes(',1,'))
  check('row 1 has no topic/year (blank baseline)', lines[1].startsWith(',,,'))
  check(
    'row 2 exports the edited topic/subtopic/year',
    lines[2].startsWith('Surgery,Hernia,2023,Question 2?'),
  )
  check('row 2 answer picked in the editor exports (D = 3)', lines[2].includes(',3,'))

  const pristine = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('codox')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const req = db
        .transaction('runArtifacts')
        .objectStore('runArtifacts')
        .get('artifact-drive')
      req.onsuccess = () => resolve(req.result?.json)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rows
  })
  check(
    'merged-rows artifact is untouched by all edits',
    pristine?.[0]?.question === 'Question 1?' &&
      pristine?.[0]?.options?.length === 4 &&
      pristine?.[0]?.correct_index === '2' &&
      pristine?.[1]?.topic === '',
  )

  await context.close()
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(failed.length === 0 ? '\nALL GREEN' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
