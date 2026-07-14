import { expect, test, type Page, type Route } from '@playwright/test'
import { unzipSync } from 'fflate'

const CSV_SCHEMA = [
  'id',
  'group_id',
  'topic',
  'subtopic',
  'year',
  'question',
  'options',
  'correct_index',
  'image_urls',
  'needs_review',
]

const BLUEPRINT = {
  csv_schema: CSV_SCHEMA,
  document_profile: {
    page_count: 2,
    question_count: 30,
    group_count: 1,
    question_pages: [1],
    answer_policy: {
      type: 'no_answer_key',
      answer_key_present: false,
      marking_style: 'none',
      worker_rule: 'leave the answer blank for review',
    },
  },
  assets: [],
  planned_rows: Array.from({ length: 30 }, (_, index) =>
    ({
      id: String(index + 1),
      group_id: 'group1',
      topic: '',
      subtopic: '',
      year: '',
      question_assembly: {
        mode: 'plain_question_prompt',
        final_format: '{question_prompt}',
      },
      regions: {
        case_stem: null,
        question_prompt: {
          page: 1,
          box_2d: [80, 50, 250, 950],
          anchor: 'question',
        },
        options: {
          page: 1,
          box_2d: [250, 50, 500, 950],
          anchor: 'options',
        },
        answer_evidence: null,
      },
      image_urls: [],
      correct_index_policy: {
        type: 'blank_no_answer_key',
        value: '',
        needs_review: 'no_answer_key',
      },
      worker_task: {
        case_stem_required: false,
        read_regions_only: false,
        must_follow_planner_structure: true,
      },
    }),
  ),
  worker_constraints: {
    may_add_rows: false,
    may_remove_rows: false,
    may_change_grouping: false,
    may_change_image_assignments: false,
    may_change_answer_policy: false,
    may_flag_planner_disagreement: false,
  },
}

const WORKER_RESPONSE = {
  rows: Array.from({ length: 30 }, (_, index) =>
    ({
      id: String(index + 1),
      group_id: 'group1',
      topic: '',
      subtopic: '',
      year: '',
      question: `Question ${index + 1}: What is two plus two?`,
      options: ['Three', 'Four'],
      correct_index: '',
      image_urls: [],
      needs_review: '',
    }),
  ),
}

const AUDIT_RESPONSE = {
  audit_pass: true,
  risk_class: 'safe_to_import',
  failed_rows: [],
  global_failures: [],
  answer_policy_violations: [],
  crop_failures: [],
  notes: [],
}

function geminiBody(text: string) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { totalTokenCount: 1 },
  }
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function mockGemini(page: Page) {
  let plannerImageCount = 0
  await page.route(
    'https://generativelanguage.googleapis.com/**',
    async (route) => {
      const request = route.request()
      if (request.method() === 'GET') {
        await fulfillJson(route, {
          models: [
            { name: 'models/gemini-3.5-flash' },
            { name: 'models/gemini-3.1-flash-lite' },
          ],
        })
        return
      }

      const body = request.postDataJSON() as {
        contents?: Array<{ parts?: Array<{ text?: string; inlineData?: unknown }> }>
      }
      const parts = body.contents?.[0]?.parts ?? []
      const prompt = parts.find((part) => typeof part.text === 'string')?.text ?? ''
      if (prompt === 'Reply with OK.') {
        await fulfillJson(route, geminiBody('OK'))
      } else if (prompt.startsWith('You are the PLANNER')) {
        plannerImageCount = parts.filter((part) => part.inlineData !== undefined).length
        await fulfillJson(route, geminiBody(JSON.stringify(BLUEPRINT)))
      } else if (prompt.startsWith('You are the WORKER')) {
        const marker = 'CHUNK PACKAGE:\n'
        const packageText = prompt
          .slice(prompt.indexOf(marker) + marker.length)
          .split('\n\nYour previous response')[0]
        const reduced = JSON.parse(packageText) as { planned_rows: Array<{ id: string }> }
        const ids = new Set(reduced.planned_rows.map((row) => row.id))
        await fulfillJson(
          route,
          geminiBody(JSON.stringify({
            rows: WORKER_RESPONSE.rows.filter((row) => ids.has(row.id)),
          })),
        )
      } else if (prompt.startsWith('You are the AUDIT model')) {
        await fulfillJson(route, geminiBody(JSON.stringify(AUDIT_RESPONSE)))
      } else {
        await route.fulfill({ status: 400, body: 'Unexpected Gemini request' })
      }
    },
  )
  return { plannerImageCount: () => plannerImageCount }
}

/** A tiny valid one-page PDF assembled in memory, so the real PDF reader runs. */
function minimalPdf(label: string): Buffer {
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

async function openApiSettings(page: Page) {
  const coachmarkAction = page.getByRole('button', { name: 'Open API settings' })
  if (await coachmarkAction.isVisible()) await coachmarkAction.click()
  else await page.getByRole('button', { name: 'API', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Gemini API key' })).toBeVisible()
}

test('critical journey: answer-key PDF → review list/detail → named export → History review/restore', async ({
  page,
}) => {
  const gemini = await mockGemini(page)
  await page.goto('/')

  await openApiSettings(page)
  await page.getByLabel('Google Gemini API key').fill('e2e-key-never-leaves-browser')
  await page.getByRole('button', { name: 'Check key' }).click()
  await expect(page.getByText('Key works. You are ready to convert.').first()).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'Critical Exam.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('What is two plus two?'),
  })
  await expect(page.getByText('Critical Exam.pdf')).toBeVisible()

  // The answer-key slot is always visible and optional — no declaration
  // question stands between the tutor and dropping the key.
  await page.locator('.ds-key-file-slot input[type="file"]').setInputFiles({
    name: 'Critical Answers.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('Answer 1: B'),
  })
  await expect(page.getByText('Critical Answers.pdf added')).toBeVisible()
  await page.getByText('Keep original PDFs', { exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Keep original PDFs' })).toBeChecked()

  // The browser may be closed or refreshed before conversion; the draft and
  // its retention choice must redraw from IndexedDB, not disappear or reset.
  await page.reload()
  await expect(page.getByText('Critical Exam.pdf')).toBeVisible()
  await expect(page.getByText('Critical Answers.pdf added')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Keep original PDFs' })).toBeChecked()

  await page.getByRole('button', { name: 'Start converting' }).click()
  const reviewButton = page.getByRole('button', { name: /Review 30 flags/ })
  await expect(reviewButton).toBeVisible({ timeout: 90_000 })
  expect(gemini.plannerImageCount()).toBe(2)

  // Every finished row is browsable below the summary. A numeric search jumps
  // and highlights without filtering the list, then detail writes only after
  // an explicit human pick and Confirm.
  await expect(page.getByText('30 questions', { exact: true })).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Find a question' })
  await search.fill('20')
  const highlightedRow = page.locator('.review-list-row--highlight')
  await expect(highlightedRow).toContainText('Question 20: What is two plus two?')
  await expect(page.locator('.review-list__viewport')).toHaveCount(0)
  const centralConsole = page.locator('.ds-work')
  await expect.poll(() => centralConsole.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const scrollBeforeDetail = await centralConsole.evaluate((element) => element.scrollTop)
  await highlightedRow.click()
  await page.getByRole('radio', { name: /Four/ }).click()
  await page.getByRole('button', { name: 'Confirm answer (Enter)' }).click()
  await page.getByRole('button', { name: 'Back to questions' }).click()
  await expect(search).toHaveValue('20')
  await expect(
    page.locator('.review-list-row').filter({ hasText: 'Question 20:' })
      .locator('.review-list-row__answer'),
  ).toHaveText('B')
  await expect(page.getByRole('button', { name: 'Needs review (29)' })).toBeVisible()
  const scrollAfterBack = await centralConsole.evaluate((element) => element.scrollTop)
  expect(Math.abs(scrollAfterBack - scrollBeforeDetail)).toBeLessThan(65)

  // Desktop export opens a Save-As picker. The native dialog cannot be
  // automated, so stub it to capture what gets written to the picked file —
  // everything up to that call (button → exporter → browser-fs-access) is real.
  await page.evaluate(() => {
    const capture = { name: '', chunks: [] as number[][] }
    ;(window as unknown as Record<string, unknown>).__savedFile = capture
    ;(window as unknown as Record<string, unknown>).showSaveFilePicker = async (
      options?: { suggestedName?: string },
    ) => {
      capture.name = options?.suggestedName ?? ''
      return {
        createWritable: async () =>
          new WritableStream({
            write(chunk: Uint8Array) {
              capture.chunks.push([...chunk])
            },
          }),
      }
    }
  })
  await page.getByRole('button', { name: 'Export as-is' }).click()
  await expect(page.getByText(/lives safely outside Codox/)).toBeVisible()
  const savedFile = await page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__savedFile as {
        name: string
        chunks: number[][]
      },
  )
  expect(savedFile.name).toBe('Critical Exam Cx.zip')
  const zipped = unzipSync(new Uint8Array(savedFile.chunks.flat()))
  const csvPath = 'Critical Exam Cx/Critical Exam Cx.csv'
  expect(Object.keys(zipped)).toContain(csvPath)
  const csv = new TextDecoder().decode(zipped[csvPath]).replace(/^\uFEFF/, '')
  expect(csv).toContain('What is two plus two?')
  expect(csv).toContain('"[""Three"",""Four""]",1,[],')

  await page.getByRole('button', { name: 'Convert another' }).click()
  await expect(page.getByText('Drop PDFs here')).toBeVisible()

  await page
    .locator('.ds-sidebar')
    .getByRole('button', { name: 'History' })
    .click()
  await expect(page.getByRole('heading', { name: 'Critical Exam.pdf' })).toBeVisible()
  await expect(page.getByText('Exported')).toBeVisible()
  await expect(page.getByText('Original PDF kept')).toBeVisible()

  await page.getByRole('button', { name: 'Review answers' }).click()
  await expect(page.getByText('30 questions', { exact: true })).toBeVisible()
  await page.locator('.review-list-row').filter({
    hasText: 'Question 1: What is two plus two?',
  }).click()
  await expect(page.getByAltText('Scanned source for question 1')).toBeVisible()
  await page.getByRole('button', { name: 'Back to questions' }).click()
  await page.getByRole('button', { name: 'Back to history' }).click()

  await page.getByRole('button', { name: 'Use PDF again' }).click()
  await expect(page.getByRole('heading', { name: 'Convert' })).toBeVisible()
  await expect(page.getByText('Critical Exam.pdf')).toBeVisible()
  await expect(page.getByText('Critical Answers.pdf added')).toBeVisible()
})

test('phone API and Help controls open bottom drawers with a large close target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  const dismissCoachmark = page.getByRole('button', {
    name: 'Dismiss API key tip',
  })
  if (await dismissCoachmark.isVisible()) await dismissCoachmark.click()

  const mobileNav = page.locator('.ds-mobile-nav')
  await mobileNav.getByRole('button', { name: 'API' }).click()
  const apiDrawer = page.getByRole('dialog', { name: 'Gemini API key' })
  await expect(apiDrawer).toBeVisible()
  const close = page.getByRole('button', { name: 'Close dialog' })
  const closeBox = await close.boundingBox()
  expect(closeBox?.width).toBeGreaterThanOrEqual(52)
  expect(closeBox?.height).toBeGreaterThanOrEqual(52)
  const drawerBox = await apiDrawer.boundingBox()
  expect(Math.round((drawerBox?.y ?? 0) + (drawerBox?.height ?? 0))).toBeGreaterThanOrEqual(
    914,
  )
  await close.click()
  await expect(apiDrawer).toBeHidden()

  await mobileNav.getByRole('button', { name: 'Help' }).click()
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await expect(page.getByText('From PDF to Triviadox bundle in four steps.')).toBeVisible()
})
