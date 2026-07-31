/**
 * Probe: read a page's handwritten answer letters as an ORDERED LIST.
 *
 * Born 2026-07-31. Rendering `EOR IM MCQ 2025-194-2nd (2) 1.pdf` showed the
 * answers are not per-question marks at all: they are a column of very large
 * letters written SIDEWAYS down the right margin, one per question in reading
 * order, each about 1.5 question-heights tall. They drift out of register with
 * their own question (page 1's first "D" overlaps Q1 AND Q2), so position
 * cannot attribute a letter to a question — only ordinal position can.
 *
 * That makes INDEX's per-question `answer_present` unanswerable on this
 * document, which is a better explanation for 0/6 on page 1 than prompt
 * hedging. This probe tests the well-posed alternative: ask ONE page for the
 * letters top-to-bottom plus the question labels that start on it, and let
 * deterministic code map letter n -> question n, refusing to map when the two
 * counts disagree (page 1 has 6 questions but 5 letters — Q6 continues
 * overleaf — so the count check is the whole safety property).
 *
 * Deliberately two short list fields, not ten per-question fields: the
 * collapse-to-a-constant failure this replaces is a property of long
 * enumerations.
 *
 * Reads the engine's OWN encoded page JPEGs so this cannot be confused with a
 * page-rendering difference. Mirrors src/providers/gemini.ts: no `role`, the
 * "\nIMAGE n:\n" label, four BLOCK_NONE safety settings, temperature 0.
 *
 * Usage: GEMINI_API_KEY=... node scripts/probe-margin-letters.mjs <pagesDir> <pages> [model] [runs]
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const [dir, pageArg, model = 'gemini-3.5-flash-lite', runs = '1'] = process.argv.slice(2)
const key = process.env.GEMINI_API_KEY
if (!dir || !pageArg || !key) {
  console.error('usage: GEMINI_API_KEY=... node scripts/probe-margin-letters.mjs <pagesDir> <pages> [model] [runs]')
  process.exit(1)
}

/** Mirrors CALL_CONCURRENCY in src/engine/executor.ts. See the note below. */
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 3)

const range = /^(\d+)-(\d+)$/.exec(pageArg)
const pageNumbers = range
  ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i)
  : pageArg.split(',').map((n) => Number(n.trim()))

const PROMPT = `You are reading ONE scanned exam page image (labeled "IMAGE 1").

Some exams have the correct answers written by hand near the edge of the page as
single letters (a, b, c, d, e). They may be very large, written sideways
(rotated 90 degrees), and may overlap the printed text. They are usually one per
question, running down the page in the same order as the questions.

Return two lists:
- "letters": every handwritten answer letter you can see on this page, in order
  from the top of the page to the bottom, lowercased. Report the glyph you
  actually see. If there are no handwritten answer letters on this page, return
  an empty list.
- "question_labels": the printed question numbers whose question text BEGINS on
  this page, in order down the page, as strings (e.g. "1", "2").

Report only what is visible. Never use subject knowledge to decide a letter.`

const schema = {
  type: 'OBJECT',
  properties: {
    letters: { type: 'ARRAY', items: { type: 'STRING' } },
    question_labels: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['letters', 'question_labels'],
}

/** One probe call. Returns the printable line, never throws. */
async function probe(number, run) {
    const jpeg = await readFile(join(dir, `page-${number}.jpg`))
    const body = {
      contents: [{
        parts: [
          { text: PROMPT },
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
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    )
    const json = await res.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return `page ${number} run ${run}: NO TEXT ${JSON.stringify(json).slice(0, 300)}`
    const parsed = JSON.parse(text)
    const letters = parsed.letters ?? []
    const labels = parsed.question_labels ?? []
    const agree = letters.length === labels.length ? 'MAP' : 'REFUSE'
    return `page ${number} run ${run}: ${letters.length} letters [${letters.join(' ')}] | `
      + `${labels.length} questions [${labels.join(' ')}] | ${agree}`
}

/**
 * Calls go out concurrently, bounded — the same shape as the engine's own
 * `mapConcurrent` (src/engine/concurrency.ts) at its `CALL_CONCURRENCY` of 3,
 * and for the same reason. The free tier's ceiling is ~15 requests per provider
 * minute, and the controller pads its pacing window because requests are paced
 * when they START but counted when they ARRIVE (`>14 requests in an AI Studio
 * minute` is recorded against the BOX pass in controller.ts). This script talks
 * to REST directly and so has no controller throttle behind it; keeping the
 * bound at 3 is what stops a wide page range from tripping a 429 on its own.
 * Results print in ITEM order, never completion order, so a run's output is
 * comparable line-for-line with the run before it.
 */
const tasks = pageNumbers.flatMap((number) =>
  Array.from({ length: Number(runs) }, (_, i) => ({ number, run: i + 1 })))
const lines = new Array(tasks.length)
let nextIndex = 0
const runner = async () => {
  for (;;) {
    const index = nextIndex
    if (index >= tasks.length) return
    nextIndex += 1
    const { number, run } = tasks[index]
    try {
      lines[index] = await probe(number, run)
    } catch (error) {
      lines[index] = `page ${number} run ${run}: FAILED ${error.message}`
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, runner))
for (const line of lines) console.log(line)
