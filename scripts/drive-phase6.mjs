/**
 * Phase-6 verification drive: a full conversion through the REAL engine in
 * a headless browser (Edge channel — no download). Only the network is
 * faked: Gemini is intercepted at the HTTP layer, so the real adapter,
 * controller, executor, PDF pipeline, and Dexie all run for real.
 *
 * Proves: start → planner → crops → worker (429 → calm quota pause →
 * auto-resume) → merge → CSV → audit → done, the CSV downloads, and the
 * whole thing survives a mid-run reload.
 *
 * Prereq: `npm run dev` on port 5173. Run: `node scripts/drive-phase6.mjs`
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { makeTestPdf } from './lib/test-pdf.mjs'

const BASE = 'http://localhost:5173'
const OUT = resolve('scripts', 'out')
const PAGE_COUNT = 3
const QUESTION_COUNT = 12 // > 10 → the worker runs in two chunks

mkdirSync(OUT, { recursive: true })
const pdfPath = resolve(OUT, 'phase6-exam.pdf')
writeFileSync(
  pdfPath,
  makeTestPdf(
    Array.from({ length: PAGE_COUNT }, (_, i) => `Codox engine drive page ${i + 1}`),
  ),
)

// ---------------------------------------------------------------- fakes

const plannedRow = (id) => ({
  id: String(id),
  group_id: `group${id}`,
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
      page: ((id - 1) % PAGE_COUNT) + 1,
      box_2d: [100, 50, 300, 900],
      anchor: 'question',
    },
    options: {
      page: ((id - 1) % PAGE_COUNT) + 1,
      box_2d: [300, 50, 500, 900],
      anchor: 'option A',
    },
    answer_evidence: null,
  },
  image_urls: id === 1 ? ['images/asset01.png'] : [],
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
})

const blueprint = {
  csv_schema: [
    'id', 'group_id', 'topic', 'subtopic', 'year',
    'question', 'options', 'correct_index', 'image_urls', 'needs_review',
  ],
  document_profile: {
    page_count: PAGE_COUNT,
    question_count: QUESTION_COUNT,
    group_count: QUESTION_COUNT,
    question_pages: [1, 2, 3],
    answer_policy: {
      type: 'no_answer_key',
      answer_key_present: false,
      marking_style: 'none',
      worker_rule: 'leave correct_index blank and set needs_review=no_answer_key',
    },
  },
  assets: [
    {
      asset_id: 'asset01',
      kind: 'case_image',
      page: 1,
      box_2d: [100, 100, 400, 600],
      output_path: 'images/asset01.png', // code rewrites this to .jpg
      linked_group_id: 'group1',
      linked_row_ids: ['1'],
      anchor: 'figure',
    },
  ],
  planned_rows: Array.from({ length: QUESTION_COUNT }, (_, i) => plannedRow(i + 1)),
  worker_constraints: {
    may_add_rows: false,
    may_remove_rows: false,
    may_change_grouping: false,
    may_change_image_assignments: false,
    may_change_answer_policy: false,
    may_flag_planner_disagreement: false,
  },
}

/** Answers exactly the row IDs the chunk package asked for, in order. */
function workerAnswer(promptText) {
  const packageJson = JSON.parse(
    promptText.slice(promptText.indexOf('CHUNK PACKAGE:') + 'CHUNK PACKAGE:'.length),
  )
  return {
    rows: packageJson.planned_rows.map((row) => ({
      id: row.id,
      group_id: row.group_id,
      topic: row.topic,
      subtopic: row.subtopic,
      year: row.year,
      // Deliberately labelled options + a comma and a quote: the CSV and
      // the label stripper both get exercised for real.
      question: `Question ${row.id}: which finding, if any, is "classic"?`,
      options: [
        'A. Rebound tenderness, guarding',
        'B. Murphy sign',
        'C. Rovsing sign',
        'D. Psoas sign',
      ],
      correct_index: '2', // policy is no_answer_key → code must blank this
      image_urls: row.image_urls,
      needs_review: 'looks_fine_to_me', // must be discarded at merge
    })),
  }
}

const auditPass = {
  audit_pass: true,
  risk_class: 'safe_to_import',
  failed_rows: [],
  global_failures: [],
  answer_policy_violations: [],
  crop_failures: [],
  notes: [],
}

/** A real RFC-4180 reader, so the CSV assertions test the CSV, not a regex. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function geminiOk(text, usage = { promptTokenCount: 1500, candidatesTokenCount: 500, totalTokenCount: 2000 }) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: usage,
    }),
  }
}

/** A real per-minute 429: RetryInfo, no PerDay quota id → "rate-limited". */
function rateLimited(retryDelaySeconds) {
  return {
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerMinutePerProject' }],
          },
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: `${retryDelaySeconds}s`,
          },
        ],
      },
    }),
  }
}

// ---------------------------------------------------------------- drive

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[console]', message.text())
})

const calls = []
let quotaHitsLeft = 1 // the first worker call gets a 429

await context.route('**/generativelanguage.googleapis.com/**', async (route) => {
  const request = route.request()
  const url = request.url()

  // The key must travel in the header, never the URL (CLAUDE.md).
  assert.ok(!url.includes('key='), `key must not be in the URL: ${url}`)
  assert.equal(
    request.headers()['x-goog-api-key'],
    'drive-key',
    'every request carries the locally stored key in the header',
  )

  if (request.method() === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          { name: 'models/gemini-3.5-flash' },
          { name: 'models/gemini-3.1-flash-lite' },
        ],
      }),
    })
  }

  const body = request.postDataJSON()
  const prompt = body.contents[0].parts[0].text
  const images = body.contents[0].parts.length - 1
  const model = /models\/([^:]+):/.exec(url)[1]
  const role = prompt.startsWith('You are the PLANNER')
    ? 'planner'
    : prompt.startsWith('You are the WORKER')
      ? 'worker'
      : 'audit'
  calls.push({ role, model, images, generationConfig: body.generationConfig })

  // Pinned runtime parameters travel on every engine call (§1.11).
  assert.equal(body.generationConfig.temperature, 0, 'temperature 0')
  assert.equal(
    body.generationConfig.responseMimeType,
    'application/json',
    'JSON-only responses',
  )

  if (role === 'planner') return route.fulfill(geminiOk(JSON.stringify(blueprint)))
  if (role === 'audit') return route.fulfill(geminiOk(JSON.stringify(auditPass)))

  if (quotaHitsLeft > 0) {
    quotaHitsLeft -= 1
    return route.fulfill(rateLimited(3))
  }
  return route.fulfill(geminiOk(JSON.stringify(workerAnswer(prompt))))
})

try {
  // Boot once so Dexie builds the schema, then seed first-run + the key.
  await page.goto(BASE)
  await page.waitForSelector('#root :first-child')
  await page.evaluate(
    () =>
      new Promise((done, fail) => {
        const request = indexedDB.open('codox')
        request.onerror = () => fail(request.error)
        request.onsuccess = () => {
          const database = request.result
          const tx = database.transaction(['meta', 'credentials'], 'readwrite')
          tx.objectStore('meta').put({
            key: 'firstRunCompletedAt',
            value: new Date().toISOString(),
          })
          tx.objectStore('credentials').put({ id: 'gemini', apiKey: 'drive-key' })
          tx.oncomplete = () => {
            database.close()
            done(undefined)
          }
          tx.onerror = () => fail(tx.error)
        }
      }),
  )
  await page.reload()
  await page.waitForSelector('#convert-heading')

  // ---------- 1. Start a real conversion ----------
  await page.setInputFiles('input[type="file"]', pdfPath)
  await page.waitForSelector('.ds-file-row')

  // Declare honestly: the fake document has no answer key, and the fake
  // planner's evidence-based policy agrees (no_answer_key). The
  // cross-check therefore stays quiet — see step 7 for the mismatch case.
  await page.getByRole('button', { name: /Inside the PDFs/ }).click()
  await page.getByRole('option', { name: 'There are no answers' }).click()

  const startButton = page.locator('button', { hasText: 'Start converting' })
  assert.ok(await startButton.isEnabled(), 'Start is real now, not disabled')
  await startButton.click()

  // ---------- 2. The quota pause reads calm, not broken ----------
  await page.waitForSelector('.ds-status-chip--quota-paused', { timeout: 60_000 })
  const pausedText = await page.textContent('.convert-progress-status')
  assert.match(
    pausedText,
    /Paused — resumes when quota allows/,
    `quota pause uses the canonical calm words (got: ${pausedText})`,
  )
  const chipText = await page.textContent('.ds-status-chip--quota-paused')
  assert.doesNotMatch(chipText, /error|failed|broken/i, 'a pause is never an error')
  await page.screenshot({ path: resolve(OUT, 'phase6-paused.png'), fullPage: true })
  console.log('quota pause: OK — calm, amber, auto-resuming')

  // ---------- 3. Mid-run reload: the checkpoint holds ----------
  await page.reload()
  await page.waitForSelector('#convert-heading')
  // The bars come back from persisted state, not from zero.
  await page.waitForSelector('.convert-run-row', { timeout: 30_000 })
  console.log('mid-run reload: OK — the run resumed from its checkpoint')

  // ---------- 4. Done ----------
  await page.waitForSelector('.convert-dev-surface', { timeout: 120_000 })
  const doneHeading = await page.textContent('.convert-stack h2')
  assert.match(
    doneHeading,
    /Done\./,
    `the done stage announces the finish (got: ${doneHeading})`,
  )
  // No answer key in the document → every row blank + flagged. That is a
  // success state, not a failure.
  assert.match(
    doneHeading,
    new RegExp(`${QUESTION_COUNT} answers need your eyes`),
    `every row is flagged for review (got: ${doneHeading})`,
  )
  await page.screenshot({ path: resolve(OUT, 'phase6-done.png'), fullPage: true })

  // ---------- 5. The CSV downloads and obeys the contract ----------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid^="dev-download-csv-"]').first().click(),
  ])
  const csvPath = resolve(OUT, 'phase6-questions.csv')
  await download.saveAs(csvPath)
  const csv = readFileSync(csvPath, 'utf8').replace(/^﻿/, '')
  const rows = parseCsv(csv)

  assert.deepEqual(
    rows[0],
    [
      'id', 'group_id', 'topic', 'subtopic', 'year',
      'question', 'options', 'correct_index', 'image_urls', 'needs_review',
    ],
    'the header is exactly the 10-column contract',
  )
  assert.equal(rows.length, QUESTION_COUNT + 1, `${QUESTION_COUNT} rows + header`)

  const first = rows[1]
  assert.equal(first[0], '1', 'row id')
  assert.equal(
    first[7],
    '',
    'correct_index is BLANK — the worker guessed "2" and the policy forced it blank',
  )
  assert.equal(
    first[9],
    'no_answer_key',
    "the flag is the policy's reason, not the worker's opinion",
  )
  assert.doesNotMatch(csv, /looks_fine_to_me/, "the worker's needs_review was discarded")
  assert.match(
    first[5],
    /which finding, if any, is "classic"\?/,
    'the question survived CSV quoting intact (comma + doubled quotes)',
  )

  assert.deepEqual(
    JSON.parse(first[6]),
    ['Rebound tenderness, guarding', 'Murphy sign', 'Rovsing sign', 'Psoas sign'],
    'enumeration labels were stripped deterministically post-merge',
  )
  assert.deepEqual(
    JSON.parse(first[8]),
    ['images/asset01.jpg'],
    'code owns the path: the planner said .png, the crop it points at is a .jpg',
  )
  assert.deepEqual(JSON.parse(rows[2][8]), [], 'a row with no figure gets an empty array')
  console.log('csv contract: OK — blank answers, stripped labels, .jpg paths')

  // ---------- 6. What actually went over the wire ----------
  const planner = calls.filter((call) => call.role === 'planner')
  const worker = calls.filter((call) => call.role === 'worker')
  const audit = calls.filter((call) => call.role === 'audit')
  assert.equal(planner.length, 1, 'exactly one planner call')
  assert.equal(planner[0].model, 'gemini-3.5-flash', 'planner model')
  assert.equal(planner[0].images, PAGE_COUNT, 'the planner saw every page')
  // 12 rows → 2 chunks; the first attempt was the 429 (retried by the
  // controller, not by the engine — the chunk retry stays unspent).
  assert.equal(worker.length, 3, 'two chunks, one of them re-sent after the pause')
  assert.equal(audit.length, 1, 'exactly one audit call')
  assert.equal(audit[0].model, 'gemini-3.1-flash-lite', 'audit model')

  const burn = await page.textContent('.convert-dev-row')
  assert.match(burn, /\d+ requests · \d+ tokens/, `quota burn is recorded (got: ${burn})`)
  console.log('calls:', JSON.stringify(calls.map((c) => `${c.role}/${c.model}`)))
  console.log('quota burn:', burn.trim())

  // ---------- 7. A wrong declaration degrades to everything-flagged ----------
  // Same document, same fake planner (policy: no_answer_key) — but now the
  // user declares the answers are inside the PDF. Codox must not produce
  // wrong rows; it flags every one of them.
  await page.locator('button', { hasText: 'Convert another' }).click()
  await page.waitForSelector('.convert-start-row')
  await page.getByRole('button', { name: /There are no answers/ }).click()
  await page.getByRole('option', { name: 'Inside the PDFs' }).click()
  await page.locator('button', { hasText: 'Start converting' }).click()

  await page.waitForSelector('.convert-dev-surface', { timeout: 120_000 })
  const [secondDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid^="dev-download-csv-"]').first().click(),
  ])
  const mismatchPath = resolve(OUT, 'phase6-wrong-declaration.csv')
  await secondDownload.saveAs(mismatchPath)
  const mismatchRows = parseCsv(readFileSync(mismatchPath, 'utf8').replace(/^﻿/, ''))

  for (const row of mismatchRows.slice(1)) {
    assert.equal(row[7], '', 'a wrong declaration never yields an answer')
    assert.equal(row[9], 'wrong_declaration', 'every row is flagged for review')
  }
  console.log(
    `wrong declaration: OK — all ${mismatchRows.length - 1} rows blank + flagged, never guessed`,
  )

  console.log('PHASE6 DRIVE: ALL GREEN')
} finally {
  await browser.close()
}
