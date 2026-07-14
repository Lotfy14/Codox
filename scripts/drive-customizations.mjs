/**
 * Customizations click-through: the Customize tab's choices persist, the
 * Convert options panel shows/hides the year field and topics editor per
 * those choices, and the topics editor commits typed topics to the job.
 * Drives the real app at http://127.0.0.1:5173 (start `npx vite` first)
 * with playwright-core + installed Edge — no real Gemini calls.
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
  await page.goto(BASE)

  const dismissCoachmark = async () => {
    await page
      .getByRole('button', { name: 'Dismiss API key tip' })
      .click({ timeout: 5000 })
      .catch(() => {})
  }
  await dismissCoachmark()

  // --- Customize tab: choices render and persist across a reload.
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  check('Customize tab opens', await page.getByRole('heading', { name: 'Customize' }).isVisible())
  const topicsOff = page.getByRole('radio', { name: /Off No topics on Convert/ })
  const yearOff = page.getByRole('radio', { name: /No year Exports have no year column/ })
  await topicsOff.click()
  await yearOff.click()
  check('topics Off selects', (await topicsOff.getAttribute('aria-checked')) === 'true')
  await page.screenshot({ path: `${OUT}customize-tab.png` })
  await page.reload()
  await dismissCoachmark()
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  check(
    'choices persist across reload',
    (await topicsOff.getAttribute('aria-checked')) === 'true' &&
      (await yearOff.getAttribute('aria-checked')) === 'true',
  )

  // --- Convert with both off: no year field, no topics slot.
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Convert' }).click()
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Drive Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('What is two plus two?'),
  })
  await page.getByText('Drive Exam.pdf').waitFor()
  check('year field hidden when off', !(await page.getByText('Year (optional)').isVisible().catch(() => false)))
  check('topics slot hidden when off', !(await page.getByText('Topics file (optional)').isVisible().catch(() => false)))
  await page.screenshot({ path: `${OUT}convert-all-off.png` })

  // --- Flip both on, type a year and a topic list.
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('radio', { name: /Convert shows a topic list/ }).click()
  await page.getByRole('radio', { name: /You type it/ }).click()
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Convert' }).click()
  await page.getByText('Year (optional)').waitFor()
  check('year field shows when on', true)
  check('topics drop zone shows when on', await page.getByText('Topics file (optional)').isVisible())
  await page.getByLabel('Year (optional)').fill('2025')

  await page.getByRole('button', { name: 'Add topic' }).click()
  await page.getByRole('textbox', { name: 'Topic 1', exact: true }).fill('Surgery')
  await page.getByRole('button', { name: 'Add subtopic' }).click()
  await page.getByRole('textbox', { name: 'Topic 1 subtopic 1' }).fill('Appendix')
  // Blur commits the draft to the job.
  await page.getByText('Keep original PDFs', { exact: true }).click()
  await page.screenshot({ path: `${OUT}convert-topics-editor.png` })

  // Reload: the committed list and year redraw from IndexedDB.
  await page.reload()
  await page.getByText('Drive Exam.pdf').waitFor()
  check(
    'typed year survives reload',
    (await page.getByLabel('Year (optional)').inputValue()) === '2025',
  )
  check(
    'typed topics survive reload',
    (await page
      .getByRole('textbox', { name: 'Topic 1', exact: true })
      .inputValue()) === 'Surgery' &&
      (await page
        .getByRole('textbox', { name: 'Topic 1 subtopic 1' })
        .inputValue()) === 'Appendix',
  )
  await page.screenshot({ path: `${OUT}convert-after-reload.png` })
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
