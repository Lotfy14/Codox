// End-to-end check of the agent-conversion import: builds a small bundle,
// imports it through the real folder picker in the Folders tab, and verifies
// the imported exam reaches Review with its questions, its figure, and its
// answers split correctly between "read from the document" and "waiting for
// approval". Screenshots to scripts/out/.
//
// Needs the dev server on 5173.  Run: node scripts/drive-agent-import.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const OUT = fileURLToPath(new URL('./out/', import.meta.url))
const REPO = fileURLToPath(new URL('../', import.meta.url))
mkdirSync(OUT, { recursive: true })

// ------------------------------------------------------ build a real bundle
const bundleRoot = path.join(OUT, 'agent-bundle')
const examDir = path.join(bundleRoot, 'cardio-2024')
rmSync(bundleRoot, { recursive: true, force: true })
mkdirSync(path.join(examDir, 'pages'), { recursive: true })
mkdirSync(path.join(examDir, 'images'), { recursive: true })

// Reuse the demo bundle agent-prepare produced when one is around; otherwise
// synthesise flat page/figure JPEGs so the driver stands on its own.
const prepared = path.join(REPO, 'agent-conversion/output/demo-batch/cardio-2024')
let pageSize = { width: 1652, height: 2338 }
if (existsSync(path.join(prepared, 'pages/page-001.jpg'))) {
  cpSync(path.join(prepared, 'pages'), path.join(examDir, 'pages'), { recursive: true })
  cpSync(path.join(prepared, 'images'), path.join(examDir, 'images'), { recursive: true })
} else {
  const sharp = (await import('sharp')).default
  pageSize = { width: 800, height: 1120 }
  const page = await sharp({
    create: { ...pageSize, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer()
  writeFileSync(path.join(examDir, 'pages/page-001.jpg'), page)
  writeFileSync(path.join(examDir, 'pages/page-002.jpg'), page)
  const figure = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#3355cc' },
  })
    .jpeg()
    .toBuffer()
  writeFileSync(path.join(examDir, 'images/fig-01.jpg'), figure)
}

writeFileSync(
  path.join(examDir, 'exam.json'),
  JSON.stringify(
    {
      codoxAgentBundle: 1,
      sourceFile: 'Cardio 2024.pdf',
      producedBy: 'drive-agent-import',
      pages: [
        { index: 0, file: 'pages/page-001.jpg', ...pageSize, role: 'exam' },
        { index: 1, file: 'pages/page-002.jpg', ...pageSize, role: 'exam' },
      ],
      figures: [
        { id: 'fig-01', file: 'images/fig-01.jpg', page: 1, box: [395, 155, 655, 690] },
      ],
      topics: [{ topic: 'Cardiology', subtopics: ['Valvular disease'] }],
      questions: [
        {
          id: 'q001',
          question: 'Which structure is outlined in the figure?',
          options: ['Aortic arch', 'Left atrium', 'Right ventricle'],
          answer: { source: 'extracted', index: 1, evidence: 'key page row 1' },
          figures: ['fig-01'],
          topic: 'Cardiology',
          subtopic: 'Valvular disease',
          year: '2024',
          page: 1,
          box: [80, 100, 700, 900],
          flag: '',
          groupId: '',
        },
        {
          id: 'q002',
          question: 'Which rhythm is most likely?',
          options: ['Atrial fibrillation', 'Sinus bradycardia'],
          answer: { source: 'reasoned', index: 0, confidence: 'likely' },
          figures: [],
          topic: 'Cardiology',
          subtopic: '',
          year: '2024',
          page: 2,
          flag: '',
          groupId: '',
        },
      ],
    },
    null,
    2,
  ),
)
writeFileSync(path.join(examDir, 'NOTES.md'), 'Read both pages. Q2 is my own reasoning.')

// The same gate an agent runs — a driver that imports an invalid bundle
// proves nothing.
execFileSync('node', [path.join(REPO, 'scripts/agent-validate.mjs'), bundleRoot], {
  stdio: 'inherit',
})

// --------------------------------------------------------------- drive the app
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  await page.getByRole('button', { name: 'Folders' }).first().click()
  await page.getByRole('heading', { name: 'Folders', level: 1 }).waitFor({ timeout: 5000 })
  await page.screenshot({ path: OUT + 'agent-import-button.png' })

  // The directory picker: Playwright can hand a folder to a webkitdirectory
  // input, which is exactly what the tutor's picker does.
  await page.setInputFiles('input[type="file"][webkitdirectory]', bundleRoot)

  await page.getByRole('heading', { name: 'Imported' }).waitFor({ timeout: 20000 })
  const summary = await page.locator('.ds-dialog__body').innerText()
  await page.screenshot({ path: OUT + 'agent-import-summary.png' })
  await page.getByRole('button', { name: 'Open review' }).click()

  // We land in the new folder, which should list the imported exam as Ready.
  await page.getByRole('heading', { name: 'agent-bundle', level: 1 }).waitFor({ timeout: 5000 })
  const listed = await page.getByText('Cardio 2024.pdf').first().isVisible()
  // The reasoned answer must be held for approval, so exactly one of the two
  // questions still needs review — never both, never none.
  const heldForReview = await page
    .getByText('1 to review')
    .first()
    .isVisible()
    .catch(() => false)
  await page.screenshot({ path: OUT + 'agent-import-folder.png', fullPage: true })

  // Review shows the extracted question and its figure.
  const questionVisible = await page
    .getByText('Which structure is outlined in the figure?')
    .first()
    .isVisible()
  await page.getByText('Which structure is outlined in the figure?').first().click()
  // Cropping a 200 DPI page takes a moment — wait for the image itself rather
  // than a fixed sleep, or the shot catches the empty state.
  await page
    .locator('.review__source img')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {})
  const images = await page.locator('.review__source img').count()
  await page.screenshot({ path: OUT + 'agent-import-review.png', fullPage: true })

  const result = {
    listed,
    heldForReview,
    questionVisible,
    imagesInDetail: images,
    summaryMentionsRead: summary.includes('1 answered from the document'),
    summaryMentionsPending: summary.includes('waiting for you to approve'),
    errors,
  }
  console.log(JSON.stringify(result, null, 2))
  if (
    !listed ||
    !heldForReview ||
    !questionVisible ||
    // The source crop and the linked figure must BOTH render, or the tutor
    // is reviewing questions they cannot check against the page.
    images < 2 ||
    !result.summaryMentionsRead ||
    !result.summaryMentionsPending ||
    errors.length > 0
  ) {
    process.exitCode = 1
  }
} catch (e) {
  console.error('FAILED:', e)
  await page.screenshot({ path: OUT + 'agent-import-failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
