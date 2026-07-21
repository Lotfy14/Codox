/**
 * Topics reparent click-through: on the Convert topics editor a tutor can
 * demote a top-level topic into a subtopic of another (the fix for a flat
 * extraction) and promote a subtopic back to its own topic. Drives the real
 * app at http://localhost:5173 (start `npx vite` first) with playwright-core
 * + installed Edge — no real Gemini calls. Screenshots land in scripts/out/.
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
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
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

  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  // Upload an exam so the Convert options panel (with the topics editor) shows.
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Convert' }).click()
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Drive Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('What is two plus two?'),
  })
  await page.getByText('Drive Exam.pdf').waitFor()

  // Turn topics mode on.
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('radio', { name: /Convert shows a topic list/ }).click()
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Convert' }).click()
  await page.getByText('Topics file (optional)').waitFor()

  // Two flat topics — the shape a flat extraction produces.
  await page.getByRole('button', { name: 'Add topic' }).click()
  await page.getByRole('textbox', { name: 'Topic 1', exact: true }).fill('Surgery')
  await page.getByRole('button', { name: 'Add topic' }).click()
  await page.getByRole('textbox', { name: 'Topic 2', exact: true }).fill('Cardiology')
  // Commit the draft (blur onto a stable control).
  await page.getByText('Keep original PDFs', { exact: true }).click()
  await page.screenshot({ path: `${OUT}reparent-before.png` })

  // Demote "Cardiology" (Topic 2) to a subtopic of "Surgery".
  const demote2 = page.getByRole('button', {
    name: /Make Cardiology a subtopic of another topic/,
  })
  check('demote control present on a topic', await demote2.isVisible())
  await demote2.click()
  await page.getByRole('option', { name: 'Surgery' }).click()

  // Cardiology should now be Surgery's subtopic, and no longer a topic.
  const asSubtopic = page.getByRole('textbox', { name: 'Topic 1 subtopic 1' })
  await asSubtopic.waitFor()
  check('demoted name lands as a subtopic', (await asSubtopic.inputValue()) === 'Cardiology')
  check(
    'demoted topic row is gone',
    !(await page
      .getByRole('textbox', { name: 'Topic 2', exact: true })
      .isVisible()
      .catch(() => false)),
  )
  await page.screenshot({ path: `${OUT}reparent-after-demote.png` })

  // Promote it back to its own topic.
  await page.getByRole('button', { name: /Make Cardiology its own topic/ }).click()
  const backAsTopic = page.getByRole('textbox', { name: 'Topic 2', exact: true })
  await backAsTopic.waitFor()
  check('promoted subtopic becomes a topic again', (await backAsTopic.inputValue()) === 'Cardiology')
  await page.screenshot({ path: `${OUT}reparent-after-promote.png` })

  // Survives reload (committed to the job).
  await page.reload()
  await page.getByText('Topics file (optional)').waitFor()
  check(
    'reparented list survives reload',
    (await page.getByRole('textbox', { name: 'Topic 1', exact: true }).inputValue()) === 'Surgery' &&
      (await page.getByRole('textbox', { name: 'Topic 2', exact: true }).inputValue()) === 'Cardiology',
  )
} finally {
  await browser.close()
}

const failed = checks.filter((entry) => !entry.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
