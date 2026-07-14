/**
 * Save-As export click-through: desktop export must open a save dialog,
 * report where the zip went, and treat a dismissed dialog as a cancel.
 * Drives the real app at http://localhost:5173 (start `npx vite` first)
 * with playwright-core + installed Edge. The native picker cannot be
 * automated, so `window.showSaveFilePicker` is stubbed in-page — everything
 * up to that call (button → exporter → browser-fs-access) runs for real.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'

const checks = []
function check(name, pass) {
  checks.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await context.newPage()
  await page.goto(BASE)
  const coachmark = page.getByRole('button', { name: 'Dismiss API key tip' })
  if (await coachmark.isVisible().catch(() => false)) await coachmark.click()

  // Seed a finished run directly in IndexedDB, reload → done panel.
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
  await page.getByText(/needs? your eyes/).first().waitFor({ timeout: 15_000 })
  const coachmarkAgain = page.getByRole('button', { name: 'Dismiss API key tip' })
  if (await coachmarkAgain.isVisible().catch(() => false)) await coachmarkAgain.click()

  check(
    'device note says desktop asks where to save',
    await page.getByText(/on desktop it asks where to save the zip/).isVisible(),
  )

  // ---- 1. Export with a stubbed picker that accepts: outcome `saved`.
  await page.evaluate(() => {
    window.__pickerCalls = []
    window.__savedBytes = 0
    window.showSaveFilePicker = async (options) => {
      window.__pickerCalls.push(options)
      return {
        createWritable: async () =>
          new WritableStream({
            write(chunk) {
              window.__savedBytes += chunk.byteLength ?? chunk.length ?? 0
            },
          }),
      }
    }
  })
  await page.getByRole('button', { name: /Export (as-is|bundle)/ }).click()
  await page.getByText(/lives safely outside Codox/).waitFor({ timeout: 15_000 })

  const pickerCalls = await page.evaluate(() => window.__pickerCalls)
  const savedBytes = await page.evaluate(() => window.__savedBytes)
  check('save dialog was requested exactly once', pickerCalls.length === 1)
  check(
    'dialog suggests the bundle name',
    pickerCalls[0]?.suggestedName === 'Drive Exam Cx.zip',
  )
  check('zip bytes were written to the picked file', savedBytes > 0)
  check(
    'run is badged Exported',
    await page.getByText('Exported', { exact: true }).isVisible(),
  )

  // ---- 2. Export again with a dismissed dialog: outcome `cancelled`.
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => {
      throw new DOMException('user dismissed', 'AbortError')
    }
  })
  await page.getByRole('button', { name: 'Export again' }).click()
  check(
    'dismissing the dialog reads as a cancel, not a failure',
    await page
      .getByText('Export cancelled. Your finished work is still saved in Codox.')
      .isVisible({ timeout: 10_000 }),
  )

  await context.close()
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(failed.length === 0 ? '\nALL GREEN' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
