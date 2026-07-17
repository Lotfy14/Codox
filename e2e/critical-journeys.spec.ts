import { expect, test, type Page, type Route } from '@playwright/test'
import { unzipSync } from 'fflate'

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
      } else if (prompt.startsWith('You are the INDEX stage')) {
        plannerImageCount += parts.filter((part) => part.inlineData !== undefined).length
        const indexResponse = {
          questions: Array.from({ length: 30 }, (_, i) => ({
            ref: 'q' + (i + 1),
            printed_label: String(i + 1),
            owner_page: 1,
            source_pages: [1],
            anchor: 'Question ' + (i + 1),
            options_present: true,
            case_stem_key: null,
            section_hint: '',
            visible_year: '',
            evidence_state: 'none',
          })),
          pages: [{
            page: 1,
            contains_question_start: true,
            first_printed_label: '1',
            last_printed_label: '30',
            section_hint: '',
          }],
        }
        await fulfillJson(route, geminiBody(JSON.stringify(indexResponse)))
      } else if (prompt.startsWith('You are the EVIDENCE / KEY MAP stage')) {
        plannerImageCount += parts.filter((part) => part.inlineData !== undefined).length
        await fulfillJson(route, geminiBody(JSON.stringify({
          type: 'uncertain', marking_style: '', evidence: [],
        })))
      } else if (prompt.startsWith('You are the FIGURE DETECT stage')) {
        await fulfillJson(route, geminiBody(JSON.stringify({ figures: [] })))
      } else if (prompt.startsWith('You are the BOX stage')) {
        const marker = 'PAGE TASKS:\n'
        const refs = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as
          Array<{ ref: string }>
        await fulfillJson(route, geminiBody(JSON.stringify({
          questions: refs.map((task) => ({
            ref: task.ref,
            question: { page: 1, box_2d: [80, 50, 250, 950], anchor: 'question' },
            options: { page: 1, box_2d: [250, 50, 500, 950], anchor: 'options' },
            case_stem: null,
            inline_evidence: null,
          })),
          figures: [],
        })))
      } else if (prompt.startsWith('You are the WORKER')) {
        const marker = 'CHUNK PACKAGE:\n'
        const packageText = prompt
          .slice(prompt.indexOf(marker) + marker.length)
          .split('\n\nYour previous response')[0]
        const reduced = JSON.parse(packageText) as {
          planned_rows: Array<{ id: string; group_id: string; year: string; image_urls: string[] }>
        }
        await fulfillJson(
          route,
          geminiBody(JSON.stringify({
            rows: reduced.planned_rows.map((row) => ({
              id: row.id,
              group_id: row.group_id,
              topic: '',
              subtopic: '',
              year: row.year,
              question: 'Question ' + row.id + ': What is two plus two?',
              options: ['Three', 'Four'],
              correct_index: '',
              image_urls: row.image_urls,
              needs_review: '',
            })),
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
  // question stands between the tutor and dropping the key. (The optional
  // topics slot shares the same styling, so scope by the zone's label.)
  await page
    .locator('.ds-key-file-slot')
    .filter({ hasText: 'Answer key (optional)' })
    .locator('input[type="file"]')
    .setInputFiles({
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
  // The row shows the number in its own column; the engine strips the
  // worker-transcribed "Question 20:" label so the text is not doubled.
  await expect(highlightedRow.locator('.review-list-row__num')).toHaveText('20')
  await expect(highlightedRow.locator('.review-list-row__text')).toHaveText(
    'What is two plus two?',
  )
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
    page.locator('.review-list-row')
      .filter({ has: page.locator('.review-list-row__num', { hasText: /^20$/ }) })
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
  await page.getByRole('button', { name: 'More export options' }).click()
  await page.getByRole('menuitem', { name: 'Download ZIP file (With answers)' }).click()
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
  // The exported projection: no id/group_id, no unprovided optional columns.
  expect(csv.split('\r\n')[0]).toBe(
    'question,options,correct_index,image_url',
  )
  expect(csv).toContain('What is two plus two?')
  expect(csv).toContain('"[""Three"",""Four""]",1,[]')

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
  await page.locator('.review-list-row')
    .filter({ has: page.locator('.review-list-row__num', { hasText: /^1$/ }) })
    .click()
  await expect(
    page.locator('.review__source').getByAltText('Scanned source for question 1'),
  ).toBeVisible()
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
