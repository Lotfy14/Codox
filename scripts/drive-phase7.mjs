/**
 * Phase-7 verification drive: Review + Export against the REAL app in a
 * headless browser (Edge channel). Only the network is faked — real
 * engine, real Dexie, real review UI, real zip.
 *
 * Proves: a 3-PDF batch converts → the done stage counts flags → Review
 * resolves flags by keyboard (digit + Enter), works fully offline, and
 * survives a reload → the all-resolved panel offers the loud export →
 * Export as-is downloads one zip holding THREE namespaced bundles
 * (`Triviadox_output/<pdf-name>/questions.csv` + `images/`), resolved
 * rows filled, unresolved rows still blank + flagged, BOM present,
 * image paths relative → the exported badge + exportedAt stamp appear.
 *
 * Prereq: `npm run dev` on port 5173. Run: `node scripts/drive-phase7.mjs`
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { unzipSync } from 'fflate'
import { makeTestPdf } from './lib/test-pdf.mjs'

const BASE = 'http://localhost:5173'
const OUT = resolve('scripts', 'out')
const PAGE_COUNT = 2
const QUESTIONS_PER_FILE = 4 // one worker chunk per file
const FILES = ['alpha.pdf', 'beta.pdf', 'gamma.pdf']
const TOTAL_FLAGS = QUESTIONS_PER_FILE * FILES.length

mkdirSync(resolve(OUT, 'phase7'), { recursive: true })
const pdfPaths = FILES.map((name) => {
  const path = resolve(OUT, 'phase7', name)
  writeFileSync(
    path,
    makeTestPdf(
      Array.from({ length: PAGE_COUNT }, (_, i) => `${name} page ${i + 1}`),
    ),
  )
  return path
})

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
    question_count: QUESTIONS_PER_FILE,
    group_count: QUESTIONS_PER_FILE,
    question_pages: [1, 2],
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
  planned_rows: Array.from({ length: QUESTIONS_PER_FILE }, (_, i) =>
    plannedRow(i + 1),
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
      question: `Question ${row.id}: which finding is classic?`,
      options: ['Rebound tenderness', 'Murphy sign', 'Rovsing sign', 'Psoas sign'],
      correct_index: '',
      image_urls: row.image_urls,
      needs_review: '',
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

function geminiOk(text) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 1500,
        candidatesTokenCount: 500,
        totalTokenCount: 2000,
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

await context.route('**/generativelanguage.googleapis.com/**', async (route) => {
  const request = route.request()
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
  const prompt = request.postDataJSON().contents[0].parts[0].text
  if (prompt.startsWith('You are the PLANNER')) {
    return route.fulfill(geminiOk(JSON.stringify(blueprint)))
  }
  if (prompt.startsWith('You are the WORKER')) {
    return route.fulfill(geminiOk(JSON.stringify(workerAnswer(prompt))))
  }
  return route.fulfill(geminiOk(JSON.stringify(auditPass)))
})

/** Digit-pick + Enter-confirm one flag, then wait for the UI to move on. */
async function resolveCurrentFlag(digit) {
  await page.keyboard.press(String(digit))
  await page
    .locator('.review-option[aria-checked="true"]')
    .waitFor({ timeout: 5_000 })
  await page.keyboard.press('Enter')
}

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

  // ---------- 1. Convert a 3-PDF batch ----------
  await page.setInputFiles('input[type="file"]', pdfPaths)
  await page.waitForSelector('.ds-file-row')
  await page.getByRole('button', { name: /Inside the PDFs/ }).click()
  await page.getByRole('option', { name: 'There are no answers' }).click()
  await page.locator('button', { hasText: 'Start converting' }).click()

  await page.waitForSelector('.convert-dev-surface', { timeout: 180_000 })
  const doneHeading = await page.textContent('.convert-stack h2')
  assert.match(
    doneHeading,
    new RegExp(`${TOTAL_FLAGS} answers need your eyes`),
    `all ${TOTAL_FLAGS} flags counted on the done stage (got: ${doneHeading})`,
  )
  const notYet = await page.textContent('.ds-badge')
  assert.match(notYet, /Not exported yet/, 'the quiet export-early badge')
  console.log(`batch done: OK — ${FILES.length} files, ${TOTAL_FLAGS} flags`)

  // ---------- 2. Review: source crop + keyboard flow ----------
  const reviewButton = page.locator('button', { hasText: /^Review \d+ flags/ })
  const reviewLabel = await reviewButton.textContent()
  assert.match(
    reviewLabel,
    new RegExp(`Review ${TOTAL_FLAGS} flags · alpha\\.pdf`),
    `the Review button names the first flagged file (got: ${reviewLabel})`,
  )
  await reviewButton.click()
  await page.waitForSelector('.review')

  const counter = await page.textContent('.review__header p')
  assert.match(counter, /Flag 1 of 4/, `per-file flag counter (got: ${counter})`)
  assert.match(counter, /question 1, page 1/, 'question + source page named')

  const why = await page.textContent('.review__question .ds-badge')
  assert.match(
    why,
    /No answer found — Codox never guesses/,
    `the why-flagged explanation uses the canonical words (got: ${why})`,
  )
  // The real source crop renders beside the answers, from stored bytes.
  await page.waitForSelector('.review-paper img[src^="blob:"]', {
    timeout: 15_000,
  })
  await page.screenshot({ path: resolve(OUT, 'phase7-review.png'), fullPage: true })

  await resolveCurrentFlag(2) // question 1 → option B (index 1)
  await page.waitForSelector('text=Flag 2 of 4')
  console.log('review keyboard flow: OK — digit picked, Enter confirmed, moved on')

  // ---------- 3. Review works fully offline ----------
  await context.setOffline(true)
  await page.waitForSelector(`text=${'You are offline. Reviewing works fully offline'}`)
  await resolveCurrentFlag(1) // question 2 → option A (index 0), offline
  await page.waitForSelector('text=Flag 3 of 4')
  await context.setOffline(false)
  console.log('offline review: OK — banner shown, flag resolved with no network')

  // ---------- 4. Resolutions survive a reload ----------
  await page.reload()
  await page.waitForSelector('.convert-dev-surface', { timeout: 30_000 })
  const afterReload = await page.textContent('.convert-stack h2')
  assert.match(
    afterReload,
    new RegExp(`${TOTAL_FLAGS - 2} answers need your eyes`),
    `two confirmed answers persisted across the reload (got: ${afterReload})`,
  )

  // ---------- 5. Finish alpha's flags → the loud all-resolved export ----------
  await page.locator('button', { hasText: /^Review \d+ flags/ }).click()
  await page.waitForSelector('.review')
  const resumed = await page.textContent('.review__header p')
  assert.match(
    resumed,
    /Flag 3 of 4/,
    `review re-opens at the first unresolved flag (got: ${resumed})`,
  )
  await resolveCurrentFlag(3) // question 3 → index 2
  await page.waitForSelector('text=Flag 4 of 4')
  await resolveCurrentFlag(4) // question 4 → index 3
  await page.waitForSelector('.review-done')
  const resolvedPanel = await page.textContent('.review-done')
  assert.match(
    resolvedPanel,
    /All flags resolved\. Your answers are in — export the bundle\./,
    'the all-resolved panel offers the loud export',
  )
  await page.screenshot({
    path: resolve(OUT, 'phase7-review-done.png'),
    fullPage: true,
  })
  await page.locator('button', { hasText: 'Back to results' }).click()
  await page.waitForSelector('.convert-done-actions')
  const nextFile = await page
    .locator('button', { hasText: /^Review \d+ flags/ })
    .textContent()
  assert.match(
    nextFile,
    new RegExp(`Review ${TOTAL_FLAGS - QUESTIONS_PER_FILE} flags · beta\\.pdf`),
    `after alpha, review points at beta (got: ${nextFile})`,
  )

  // ---------- 6. Export as-is: one zip, three namespaced bundles ----------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: 'Export as-is' }).click(),
  ])
  assert.equal(
    download.suggestedFilename(),
    'Triviadox_output.zip',
    'the zip is named for what it holds',
  )
  const zipPath = resolve(OUT, 'phase7-export.zip')
  await download.saveAs(zipPath)
  const unzipped = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const entries = Object.keys(unzipped).sort()

  for (const name of ['alpha', 'beta', 'gamma']) {
    assert.ok(
      entries.includes(`Triviadox_output/${name}/questions.csv`),
      `bundle folder for ${name}`,
    )
    assert.ok(
      entries.includes(`Triviadox_output/${name}/images/asset01.jpg`),
      `crop image inside ${name}'s own images/ folder`,
    )
    assert.ok(
      unzipped[`Triviadox_output/${name}/images/asset01.jpg`].length > 0,
      'the crop has real bytes',
    )
  }

  const readCsv = (name) => {
    const bytes = unzipped[`Triviadox_output/${name}/questions.csv`]
    assert.deepEqual(
      [bytes[0], bytes[1], bytes[2]],
      [0xef, 0xbb, 0xbf],
      'questions.csv starts with the UTF-8 BOM',
    )
    return parseCsv(new TextDecoder().decode(bytes.subarray(3)))
  }

  // alpha: the four confirmed answers are in; flags cleared.
  const alpha = readCsv('alpha')
  assert.equal(alpha.length, QUESTIONS_PER_FILE + 1)
  const picks = ['1', '0', '2', '3']
  for (const [i, pick] of picks.entries()) {
    assert.equal(alpha[i + 1][7], pick, `alpha row ${i + 1} carries the confirmed answer`)
    assert.equal(alpha[i + 1][9], '', `alpha row ${i + 1} is no longer flagged`)
  }
  // The row's image path is relative and resolves inside the bundle.
  assert.deepEqual(JSON.parse(alpha[1][8]), ['images/asset01.jpg'])

  // beta + gamma: untouched rows stay blank + flagged — never guessed.
  for (const name of ['beta', 'gamma']) {
    const rows = readCsv(name)
    for (const row of rows.slice(1)) {
      assert.equal(row[7], '', `${name}: unresolved answers export blank`)
      assert.equal(row[9], 'no_answer_key', `${name}: the flag reason ships`)
    }
  }
  console.log('export: OK — 3 namespaced bundles, resolved rows filled, flags honest')

  // ---------- 7. Export-early state: badge + stamp ----------
  await page.waitForSelector('text=Saved. The bundle now lives safely outside Codox')
  const badge = await page.textContent('.ds-badge')
  assert.match(badge, /Exported/, 'the badge flips to Exported')
  await page.waitForSelector('button:has-text("Export again")')
  const stamped = await page.evaluate(
    () =>
      new Promise((done, fail) => {
        const request = indexedDB.open('codox')
        request.onerror = () => fail(request.error)
        request.onsuccess = () => {
          const database = request.result
          const tx = database.transaction('runs', 'readonly')
          const all = tx.objectStore('runs').getAll()
          all.onsuccess = () => {
            database.close()
            done(all.result.map((run) => typeof run.exportedAt))
          }
        }
      }),
  )
  assert.deepEqual(stamped, ['number', 'number', 'number'], 'every run stamped exportedAt')
  await page.screenshot({ path: resolve(OUT, 'phase7-exported.png'), fullPage: true })

  console.log('PHASE7 DRIVE: ALL GREEN')
} finally {
  await browser.close()
}
