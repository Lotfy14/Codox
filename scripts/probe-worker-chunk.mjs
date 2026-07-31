/**
 * Reproduce a PRODUCTION-SHAPED worker chunk in one Gemini call.
 *
 * `probe-worker-answer.mjs` isolates one page and a handful of rows. That shape
 * cleared the worker of inventing answers on an unanswered exam (2026-07-30) —
 * but a real chunk is ~10 rows across 2 page images, and `Docs/ANSWER_LAYOUTS`
 * still lists that as uncovered. Measured 2026-07-31 on
 * `EOR SUR MCQ 2025-194-1st.pdf` (an exam with NO answer marks anywhere): a
 * full conversion filled `correct_index` on 33 of 65 rows, every spot-checked
 * pick being the medically correct one. This script is the cheap way to
 * reproduce that and to A/B a candidate WORKER prompt against it — one call per
 * variant instead of ~16 for a conversion.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/probe-worker-chunk.mjs <pdf> \
 *     [--pages 1,2] [--rows 10] [--model gemini-3.5-flash-lite] \
 *     [--policy inline_marks] [--prompt-file variant.txt]
 *
 * `--prompt-file` swaps in a candidate WORKER prompt; without it the pinned one
 * is used verbatim. `--policy` sets the blueprint's document answer_policy so
 * the no_answer_key / uncertain paths can be probed too.
 */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'

const { values, positionals } = parseArgs({
  options: {
    pages: { type: 'string', default: '1,2' },
    rows: { type: 'string', default: '10' },
    model: { type: 'string', default: 'gemini-3.5-flash-lite' },
    policy: { type: 'string', default: 'inline_marks' },
    'prompt-file': { type: 'string' },
  },
  allowPositionals: true,
})

const file = positionals[0]
const key = process.env.GEMINI_API_KEY
if (!file || !key) {
  console.error('usage: GEMINI_API_KEY=... node scripts/probe-worker-chunk.mjs <pdf> [--pages 1,2] [--rows 10]')
  process.exit(1)
}

const pages = values.pages.split(',').map((p) => Number(p.trim())).filter((p) => Number.isFinite(p))
const rowCount = Number(values.rows)

let WORKER_PROMPT
if (values['prompt-file']) {
  WORKER_PROMPT = await readFile(values['prompt-file'], 'utf8')
} else {
  const promptsSrc = await readFile(new URL('../src/engine/prompts.ts', import.meta.url), 'utf8')
  const match = /export const WORKER_PROMPT: string = ("(?:[^"\\]|\\.)*")/.exec(promptsSrc)
  if (!match) throw new Error('could not read WORKER_PROMPT')
  WORKER_PROMPT = JSON.parse(match[1])
}

const library = await PDFiumLibrary.init()
const doc = await library.loadDocument(new Uint8Array(await readFile(file)))
const jpegs = []
for (const n of pages) {
  const page = doc.getPage(n - 1)
  const rendered = await page.render({ scale: 2, render: 'bitmap' })
  jpegs.push(
    await sharp(rendered.data, { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
      .jpeg({ quality: 80 })
      .toBuffer(),
  )
}
doc.destroy()
library.destroy()

// The worker sees image numbers, not PDF page numbers — same as the real chunk.
const wholePage = (imageNumber) => ({ page: imageNumber, box_2d: [0, 0, 1000, 1000] })
const planned = Array.from({ length: rowCount }, (_, i) => {
  // Spread the rows across the supplied images the way a real chunk does.
  const imageNumber = Math.min(pages.length, Math.floor((i * pages.length) / rowCount) + 1)
  return {
    id: String(i + 1),
    group_id: `group${String(i + 1).padStart(2, '0')}`,
    topic: '', subtopic: '', year: '',
    question_assembly: { mode: 'plain_question_prompt', final_format: '{question_prompt}' },
    regions: {
      case_stem: null,
      question_prompt: wholePage(imageNumber),
      options: wholePage(imageNumber),
      answer_evidence: values.policy === 'no_answer_key' ? null : wholePage(imageNumber),
    },
    image_urls: [],
    correct_index_policy:
      values.policy === 'no_answer_key'
        ? { type: 'blank_no_answer_key', value: '', needs_review: 'no_answer_key' }
        : { type: 'extract_visible_evidence', value: '', needs_review: '' },
    worker_task: { case_stem_required: false, read_regions_only: false, must_follow_planner_structure: true },
    source_pages: [imageNumber],
  }
})

const reduced = {
  csv_schema: ['id', 'group_id', 'topic', 'subtopic', 'year', 'question', 'options', 'correct_index', 'image_urls', 'needs_review'],
  document_profile: {
    page_count: pages.length,
    question_count: rowCount,
    group_count: rowCount,
    question_pages: pages.map((_, i) => i + 1),
    answer_policy: {
      type: values.policy,
      answer_key_present: false,
      marking_style: '',
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

const parts = [{ text: [WORKER_PROMPT, '', 'CHUNK PACKAGE:', JSON.stringify(reduced)].join('\n') }]
jpegs.forEach((jpeg, i) => {
  parts.push({ text: `\nIMAGE ${i + 1}:\n` })
  parts.push({ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } })
})

const body = {
  contents: [{ parts }],
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ],
  generationConfig: { temperature: 0, maxOutputTokens: 65536, responseMimeType: 'application/json' },
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${values.model}:generateContent?key=${key}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
)
const json = await res.json()
const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
if (!text) {
  console.error('no text in response:', JSON.stringify(json).slice(0, 800))
  process.exit(1)
}
const rows = JSON.parse(text).rows ?? []
let filled = 0
for (const row of rows) {
  const answer = String(row.correct_index ?? '')
  if (answer.trim() !== '') filled += 1
  const options = Array.isArray(row.options) ? row.options : []
  const picked = /^\d+$/.test(answer.trim()) ? options[Number(answer)] : undefined
  // A variant prompt may ask the worker to report the mark it saw; show it,
  // since that is the whole point of such a variant.
  const mark = row.answer_mark === undefined ? '' : ` mark=${JSON.stringify(row.answer_mark)}`
  console.log(
    `  ${String(row.id).padEnd(3)} ci=${JSON.stringify(answer).padEnd(5)} opts=${options.length}` +
    ` | ${String(row.question ?? '').slice(0, 52)}` +
    (mark === '' ? '' : `\n     ${mark}`) +
    (picked === undefined ? '' : `\n      -> ${String(picked).slice(0, 60)}`),
  )
}
console.log(
  `\nmodel=${values.model} policy=${values.policy} pages=${pages.join(',')} rows=${rows.length}` +
  `  FILLED ${filled}/${rows.length}` +
  (values['prompt-file'] ? `  prompt=${values['prompt-file']}` : '  prompt=pinned'),
)
