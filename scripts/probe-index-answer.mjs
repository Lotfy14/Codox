/**
 * Isolate the INDEX stage's `answer_present` call on ONE page.
 *
 * Born 2026-07-30: a document with legible handwritten answer letters down the
 * right margin came back with `answer_present: false` for 49 of 50 questions,
 * so every row was blanked by policy and the worker was never allowed to read
 * an answer. This probe asks whether INDEX fails because the response is long
 * (50 questions in one window) or because it does not perceive margin letters
 * as answers at all — send it a single page and see.
 *
 * Reproduces buildIndexRequest faithfully: same INDEX_PROMPT, same CORE PAGES
 * suffix, same responseSchema, temperature 0. It talks to the REST endpoint
 * directly, so it does NOT use the app's JPEG encoder — treat a difference of
 * a few percent in image quality as out of scope; the marks here are large.
 *
 * Usage: GEMINI_API_KEY=... node scripts/probe-index-answer.mjs <pdf> <pages> [model]
 *        <pages> is a comma list or a range, e.g. "3" or "1-8".
 */
import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'

const [file, pageArg, model = 'gemini-3.5-flash-lite'] = process.argv.slice(2)
const key = process.env.GEMINI_API_KEY
if (!file || !pageArg || !key) {
  console.error('usage: GEMINI_API_KEY=... node scripts/probe-index-answer.mjs <pdf> <pages> [model]')
  process.exit(1)
}

const range = /^(\d+)-(\d+)$/.exec(pageArg)
const pageNumbers = range
  ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i)
  : pageArg.split(',').map((n) => Number(n.trim()))

// The INDEX prompt, read out of the generated constants so this probe can
// never drift from what the engine actually sends.
const promptsSrc = await readFile(new URL('../src/engine/prompts.ts', import.meta.url), 'utf8')
const match = /export const INDEX_PROMPT = ("(?:[^"\\]|\\.)*")/.exec(promptsSrc)
if (!match) throw new Error('could not read INDEX_PROMPT')
// PROBE_PROMPT_EXTRA appends a candidate instruction; PROBE_PROMPT_FILE
// REPLACES the prompt outright. Appending is close to useless for testing a
// leniency change — the restrictive clause is still there and still wins — so
// reach for the file when the edit is to existing wording.
const INDEX_PROMPT = process.env.PROBE_PROMPT_FILE
  ? await readFile(process.env.PROBE_PROMPT_FILE, 'utf8')
  : JSON.parse(match[1]) + (process.env.PROBE_PROMPT_EXTRA ?? '')

// A directory of `page-N.jpg` (cli-convert's debug/pages) feeds the engine's
// OWN encoded images back in, which is the only way to tell an INDEX problem
// apart from a page-rendering problem.
const jpegs = []
if (statSync(file).isDirectory()) {
  for (const number of pageNumbers) {
    jpegs.push(await readFile(join(file, `page-${number}.jpg`)))
  }
} else {
  const library = await PDFiumLibrary.init()
  const doc = await library.loadDocument(new Uint8Array(await readFile(file)))
  for (const number of pageNumbers) {
    const page = doc.getPage(number - 1)
    const rendered = await page.render({ scale: 2, render: 'bitmap' })
    jpegs.push(await sharp(rendered.data, {
      raw: { width: rendered.width, height: rendered.height, channels: 4 },
    }).jpeg({ quality: 80 }).toBuffer())
  }
  doc.destroy()
  library.destroy()
}
for (let i = 0; i < jpegs.length; i += 1) {
  const meta = await sharp(jpegs[i]).metadata()
  console.log(`  image ${i + 1}: ${meta.width}x${meta.height}, ${Math.round(jpegs[i].length / 1024)}KB`)
}

const questionSchema = {
  type: 'OBJECT',
  properties: {
    ref: { type: 'STRING' }, printed_label: { type: 'STRING' }, owner_page: { type: 'INTEGER' },
    source_pages: { type: 'ARRAY', items: { type: 'INTEGER' } }, anchor: { type: 'STRING' },
    options_present: { type: 'BOOLEAN' }, case_stem_key: { type: 'STRING', nullable: true },
    section_hint: { type: 'STRING' }, visible_year: { type: 'STRING' },
    answer_present: { type: 'BOOLEAN' },
  },
  required: ['ref', 'printed_label', 'owner_page', 'source_pages', 'anchor',
    'options_present', 'case_stem_key', 'section_hint', 'visible_year', 'answer_present'],
}

// Mirrors src/providers/gemini.ts exactly: no `role`, the "\nIMAGE n:\n"
// label format, the four BLOCK_NONE safety settings, and PLANNER_MAX_TOKENS.
const label = (i) =>
  process.env.PROBE_PLAIN_LABEL ? `IMAGE ${i + 1}` : `\nIMAGE ${i + 1}:\n`

const body = {
  contents: [{
    ...(process.env.PROBE_ROLE ? { role: 'user' } : {}),
    parts: [
      { text: INDEX_PROMPT + '\n\nCORE PAGES: ' + JSON.stringify(pageNumbers.map((_, i) => i + 1)) },
      ...jpegs.flatMap((jpeg, i) => [
        { text: label(i) },
        { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
      ]),
    ],
  }],
  ...(process.env.PROBE_NO_SAFETY ? {} : {
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }),
  generationConfig: {
    temperature: 0,
    maxOutputTokens: Number(process.env.PROBE_MAXTOK ?? 65536),
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        questions: { type: 'ARRAY', items: questionSchema },
        pages: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              page: { type: 'INTEGER' }, contains_question_start: { type: 'BOOLEAN' },
              first_printed_label: { type: 'STRING' }, last_printed_label: { type: 'STRING' },
              section_hint: { type: 'STRING' },
            },
            required: ['page', 'contains_question_start', 'first_printed_label', 'last_printed_label', 'section_hint'],
          },
        },
      },
      required: ['questions', 'pages'],
    },
  },
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
)
const json = await res.json()
const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
if (!text) {
  console.error('no text in response:', JSON.stringify(json).slice(0, 800))
  process.exit(1)
}
const parsed = JSON.parse(text)
console.log(`model ${model} | pages ${pageArg} | ${parsed.questions.length} questions`)
const byPage = new Map()
for (const q of parsed.questions) {
  const bucket = byPage.get(q.owner_page) ?? { yes: 0, total: 0 }
  bucket.total += 1
  if (q.answer_present) bucket.yes += 1
  byPage.set(q.owner_page, bucket)
}
for (const [page, bucket] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  image ${page}: answer_present true for ${bucket.yes}/${bucket.total}`)
}
const yes = parsed.questions.filter((q) => q.answer_present).length
console.log(`answer_present TRUE: ${yes} of ${parsed.questions.length}`)
