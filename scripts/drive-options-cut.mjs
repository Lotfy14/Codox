/**
 * A question whose options were cut by the page break: review must say so and
 * show the top of the NEXT page, because the question's own crop can never
 * contain the missing options. Seeds a finished run whose first row is flagged
 * `options_cut_at_page_break` (3 of 4 options), with real page images for the
 * question's page and the one it continues onto.
 * Drives the real app at http://127.0.0.1:5173 (start `npx vite` first)
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

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Cut Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('Cardinal signs of Parkinsonism'),
  })
  await page.getByText('1 PDF ready').waitFor({ timeout: 30_000 })

  // Seed a finished run: row 1 is the last question on page 2 and lost its
  // fourth option to the page break; row 2 is the first question on page 3.
  await page.evaluate(async () => {
    const drawPage = async (lines, footer) => {
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 840
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fdfcf7'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#1a1a1a'
      ctx.font = '20px serif'
      lines.forEach(([text, y]) => ctx.fillText(text, 40, y))
      ctx.font = 'italic 16px serif'
      ctx.fillText(footer, 40, 810)
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85),
      )
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
      }
    }

    const questionPage = await drawPage(
      [
        ['10) Which feature of Cushing syndrome is most specific?', 120],
        ['a- Hypertension', 150],
        ['b- Osteoporosis', 180],
        ['c- Broad violaceous striae', 210],
        ['d- Obesity', 240],
        ['11) The following are the cardinal signs of Parkinsonism, EXCEPT:', 620],
        ['a- Brisk reflexes', 660],
        ['b- Tremor at rest, impaired postural instability', 700],
        ['c- Bradykinesia', 740],
      ],
      'Page 2 of 15',
    )
    const continuationPage = await drawPage(
      [
        ['d- Rigidity', 60],
        ['12) A 60-year-old man presents with exertional chest pain.', 260],
        ['a- Stable angina', 300],
        ['b- Pericarditis', 340],
      ],
      'Page 3 of 15',
    )

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
      needs_review: '',
      ...fill,
    })
    const planned = (id, page, promptTop) => ({
      id,
      group_id: '',
      topic: '',
      subtopic: '',
      year: '',
      question_assembly: { mode: 'plain_question_prompt', final_format: '{question_prompt}' },
      regions: {
        case_stem: null,
        question_prompt: { page, box_2d: [promptTop, 40, promptTop + 60, 960] },
        options: { page, box_2d: [promptTop + 60, 40, promptTop + 200, 960] },
        answer_evidence: { page, box_2d: [0, 0, 1000, 1000] },
      },
      image_urls: [],
      correct_index_policy: { type: 'extract_visible_evidence', value: '', needs_review: '' },
      worker_task: {
        case_stem_required: false,
        read_regions_only: false,
        must_follow_planner_structure: true,
      },
    })

    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('codox')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction(['runs', 'runArtifacts'], 'readwrite')
    const now = Date.now()
    tx.objectStore('runs').put({
      id: 'run-cut',
      jobId: 'current',
      pdfId: 'pdf-cut',
      fileName: 'Cut Exam.pdf',
      status: 'done',
      step: 'audit',
      flaggedRows: 1,
      pageCount: 15,
      pagesRendered: 15,
      createdAt: now,
      updatedAt: now,
    })
    const artifacts = tx.objectStore('runArtifacts')
    artifacts.put({
      id: 'artifact-cut-rows',
      runId: 'run-cut',
      kind: 'merged-rows',
      json: [
        row('1', {
          question: 'The following are the cardinal signs of Parkinsonism, EXCEPT:',
          options: [
            'Brisk reflexes',
            'Tremor at rest, impaired postural instability',
            'Bradykinesia',
          ],
          needs_review: 'options_cut_at_page_break',
        }),
        row('2', {
          question: 'A 60-year-old man presents with exertional chest pain.',
          correct_index: '0',
        }),
      ],
      createdAt: now,
    })
    artifacts.put({
      id: 'artifact-cut-blueprint',
      runId: 'run-cut',
      kind: 'blueprint-valid',
      json: {
        document_profile: {
          page_count: 15,
          question_count: 2,
          group_count: 0,
          question_pages: [2, 3],
          answer_policy: {
            type: 'inline_marks',
            answer_key_present: false,
            marking_style: '',
            worker_rule: '',
          },
        },
        planned_rows: [planned('1', 2, 700), planned('2', 3, 280)],
        assets: [],
      },
      createdAt: now,
    })
    artifacts.put({
      id: 'artifact-cut-page-1',
      runId: 'run-cut',
      kind: 'page-jpeg',
      pageIndex: 1,
      bytes: questionPage.bytes,
      width: questionPage.width,
      height: questionPage.height,
      createdAt: now,
    })
    artifacts.put({
      id: 'artifact-cut-page-2',
      runId: 'run-cut',
      kind: 'page-jpeg',
      pageIndex: 2,
      bytes: continuationPage.bytes,
      width: continuationPage.width,
      height: continuationPage.height,
      createdAt: now,
    })
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })

  // Reload archives the seeded run to History (fresh-on-reload), which is
  // where a tutor comes back to a finished conversion anyway.
  await page.reload()
  await dismissCoachmark()
  await page.getByRole('tab', { name: 'History' }).click().catch(async () => {
    await page.getByRole('button', { name: 'History' }).click()
  })
  await page.getByRole('button', { name: 'Review answers' }).first().click()
  await page.getByText('2 questions').waitFor({ timeout: 15_000 })

  // ---- The cut row: notice + continuation strip.
  await page.getByRole('listitem').filter({ hasText: 'cardinal signs' }).first().click()
  const notice = page.getByText(/continues on page 3, so some options may be missing/i)
  await notice.waitFor({ timeout: 10_000 })
  check('the cut row says its options continue on page 3', await notice.isVisible())

  const continuation = page.locator('.review__source figure').filter({ hasText: 'Continues on page 3' })
  await continuation.waitFor({ timeout: 10_000 })
  check('the source column shows the continuation strip', await continuation.isVisible())
  const strip = continuation.locator('img')
  const stripLoaded = await strip.evaluate((img) => img.complete && img.naturalWidth > 0)
  check('the continuation image actually renders', stripLoaded)
  // The strip is the TOP of page 3 only — cropped above that page's first
  // question, not the whole page.
  const stripBox = await strip.evaluate((img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }))
  check(
    `the strip is a top crop, not the whole page (${stripBox.width}x${stripBox.height})`,
    stripBox.height < 840 && stripBox.height > 100,
  )
  await page.screenshot({ path: `${OUT}options-cut-detail.png`, fullPage: true })

  // ---- A clean row carries neither.
  await page.getByRole('button', { name: 'Next (→)' }).click()
  await page.locator('.review__question h3').filter({ hasText: 'exertional chest pain' }).waitFor()
  check(
    'a row that was not cut shows no continuation notice',
    (await page.getByText(/some options may be missing/i).count()) === 0,
  )
  check(
    'a row that was not cut shows no continuation strip',
    (await page.locator('.review__source figure').filter({ hasText: 'Continues on page' }).count()) === 0,
  )
  await page.screenshot({ path: `${OUT}options-cut-clean-row.png`, fullPage: true })
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
