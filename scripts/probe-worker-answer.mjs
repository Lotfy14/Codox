/**
 * Isolate the WORKER stage's answer reading on one page.
 *
 * Born 2026-07-30, to answer the question that gates removing INDEX's
 * `answer_present` veto: with every row permitted to carry an answer, does the
 * worker INVENT answers on a genuinely unanswered exam? That is the negative
 * case `Docs/ANSWER_LAYOUTS.md` has always listed as uncovered, and it is now
 * load-bearing — the worker's own restraint is the only thing left.
 *
 * Builds the request the way `buildWorkerRequest` does: the pinned WORKER
 * prompt, then "CHUNK PACKAGE:" and a reduced blueprint whose rows all carry
 * `extract_visible_evidence` (the post-change policy). Run it on an ANSWERED
 * page and an UNANSWERED page of the same exam and compare.
 *
 * Usage: GEMINI_API_KEY=... node scripts/probe-worker-answer.mjs <pdf> <page> [model]
 */
import { readFile } from 'node:fs/promises'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'

const [file, pageArg, model = 'gemini-3.1-flash-lite'] = process.argv.slice(2)
const key = process.env.GEMINI_API_KEY
if (!file || !pageArg || !key) {
  console.error('usage: GEMINI_API_KEY=... node scripts/probe-worker-answer.mjs <pdf> <page> [model]')
  process.exit(1)
}
const rowCount = Number(process.env.PROBE_ROWS ?? 6)

const promptsSrc = await readFile(new URL('../src/engine/prompts.ts', import.meta.url), 'utf8')
const match = /export const WORKER_PROMPT: string = ("(?:[^"\\]|\\.)*")/.exec(promptsSrc)
if (!match) throw new Error('could not read WORKER_PROMPT')
const WORKER_PROMPT = JSON.parse(match[1])

const library = await PDFiumLibrary.init()
const doc = await library.loadDocument(new Uint8Array(await readFile(file)))
const page = doc.getPage(Number(pageArg) - 1)
const rendered = await page.render({ scale: 2, render: 'bitmap' })
const jpeg = await sharp(rendered.data, {
  raw: { width: rendered.width, height: rendered.height, channels: 4 },
}).jpeg({ quality: 80 }).toBuffer()
doc.destroy()
library.destroy()

const wholePage = { page: 1, box_2d: [0, 0, 1000, 1000] }
const planned = Array.from({ length: rowCount }, (_, i) => ({
  id: String(i + 1),
  group_id: `group${String(i + 1).padStart(2, '0')}`,
  topic: '', subtopic: '', year: '',
  question_assembly: { mode: 'plain_question_prompt', final_format: '{question_prompt}' },
  regions: {
    case_stem: null,
    question_prompt: wholePage,
    options: wholePage,
    // The post-change policy: permission granted for every row.
    answer_evidence: wholePage,
  },
  image_urls: [],
  correct_index_policy: { type: 'extract_visible_evidence', value: '', needs_review: '' },
  worker_task: { case_stem_required: false, read_regions_only: false, must_follow_planner_structure: true },
  source_pages: [1],
}))

const reduced = {
  csv_schema: ['id', 'group_id', 'topic', 'subtopic', 'year', 'question', 'options', 'correct_index', 'image_urls', 'needs_review'],
  document_profile: {
    page_count: 1, question_count: rowCount, group_count: rowCount, question_pages: [1],
    answer_policy: {
      type: 'inline_marks', answer_key_present: false, marking_style: '',
      worker_rule: 'extract only from planner-specified visible evidence',
    },
  },
  worker_constraints: {
    may_add_rows: false, may_remove_rows: false, may_change_grouping: false,
    may_change_image_assignments: false, may_change_answer_policy: false,
    may_flag_planner_disagreement: false,
  },
  planned_rows: planned,
  assets: [],
}

const body = {
  contents: [{
    parts: [
      { text: [WORKER_PROMPT, '', 'CHUNK PACKAGE:', JSON.stringify(reduced)].join('\n') },
      { text: '\nIMAGE 1:\n' },
      { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
    ],
  }],
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ],
  generationConfig: { temperature: 0, maxOutputTokens: 65536, responseMimeType: 'application/json' },
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
)
const json = await res.json()
const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
if (!text) {
  console.error('no text in response:', JSON.stringify(json).slice(0, 600))
  process.exit(1)
}
const rows = JSON.parse(text).rows ?? []
let filled = 0
for (const row of rows) {
  const answer = String(row.correct_index ?? '')
  if (answer.trim() !== '') filled += 1
  const options = Array.isArray(row.options) ? row.options : []
  const picked = /^\d+$/.test(answer.trim()) ? options[Number(answer)] : undefined
  console.log(
    `  ${String(row.id).padEnd(3)} correct_index=${JSON.stringify(answer).padEnd(5)}` +
    ` opts=${options.length} ${picked === undefined ? '' : '-> ' + String(picked).slice(0, 42)}`,
  )
}
console.log(`filled correct_index: ${filled} of ${rows.length}`)
