/**
 * Classify exam PDFs by SHAPE before spending any quota on them, so a test
 * corpus is chosen by what the document actually is (digital vs photographed,
 * how many questions, whether answers are printed) rather than by its filename.
 *
 * Usage:  node scripts/survey-pdfs.mjs <dir-or-pdf> [more...] [--json out.json]
 *
 * No Gemini calls. Text comes from the PDF's own text layer via pdfjs — a
 * document with no text layer is a scan, which is the single most important
 * axis for this engine (a scan means every stage is doing real vision work).
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt === -1 ? null : args[jsonAt + 1]
const targets = jsonAt === -1 ? args : args.slice(0, jsonAt)

if (targets.length === 0) {
  console.error('usage: node scripts/survey-pdfs.mjs <dir-or-pdf> [...] [--json out.json]')
  process.exit(1)
}

async function collectPdfs(target) {
  const s = await stat(target)
  if (s.isFile()) return target.toLowerCase().endsWith('.pdf') ? [target] : []
  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
    .map((e) => path.join(target, e.name))
}

// pdfjs rarely emits reliable line breaks, so labels are matched on a
// whitespace boundary rather than a line start — anchoring to ^ silently
// scored real digital documents as having zero questions.
// A question label: "1.", "1)", "Q1.", "Q 1 -".
const QUESTION_LABEL = /(?:^|\s)(?:q\s*)?\d{1,3}\s*[.)\-:]\s/gi
// An option label: "a)", "a.", "A-", "(a)".
const OPTION_LABEL = /(?:^|\s)\(?[a-eA-E]\s*[.)-]\s/g
// A printed answer beside the question, the layout ANSWER_LAYOUTS calls
// "beside-the-question": "Answer: C", "Ans. B", "correct answer is D".
const PRINTED_ANSWER = /\b(?:answer|ans|correct)\b\s*[:.-]?\s*\(?[a-eA-E]\)?\b/gi

function countOf(re, text) {
  const m = text.match(re)
  return m ? m.length : 0
}

async function survey(file) {
  const row = { file: path.basename(file), dir: path.dirname(file) }
  try {
    const bytes = new Uint8Array(await readFile(file))
    row.sizeMb = +(bytes.length / 1e6).toFixed(1)
    const pdf = await getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise
    row.pages = pdf.numPages

    // Sample rather than read every page: enough to classify, cheap on a
    // 400-page document.
    const sampleCount = Math.min(pdf.numPages, 8)
    const step = Math.max(1, Math.floor(pdf.numPages / sampleCount))
    let text = ''
    let sampled = 0
    for (let p = 1; p <= pdf.numPages && sampled < sampleCount; p += step) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      text += content.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('') + '\n'
      sampled += 1
    }
    row.sampledPages = sampled
    row.chars = text.replace(/\s+/g, ' ').trim().length
    row.charsPerPage = Math.round(row.chars / Math.max(1, sampled))
    // Under ~200 chars/page there is effectively no text layer: a photograph or
    // an image-only scan. This is the axis that decides how hard the run is.
    row.capture = row.charsPerPage < 200 ? 'scan' : row.charsPerPage < 900 ? 'sparse' : 'digital'
    row.questionLabels = countOf(QUESTION_LABEL, text)
    row.optionLabels = countOf(OPTION_LABEL, text)
    row.printedAnswers = countOf(PRINTED_ANSWER, text)
    row.estQuestions = row.capture === 'scan' ? null : Math.round((row.questionLabels / Math.max(1, sampled)) * pdf.numPages)
    row.arabic = /[؀-ۿ]/.test(text)
    await pdf.cleanup()
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err)
  }
  return row
}

const files = (await Promise.all(targets.map(collectPdfs))).flat()
const rows = []
for (const f of files) {
  const r = await survey(f)
  rows.push(r)
  if (r.error) {
    console.log(`${r.file}\n    ERROR ${r.error}`)
  } else {
    console.log(
      `${r.file}\n    ${r.pages}p ${r.sizeMb}MB  ${r.capture} (${r.charsPerPage} ch/pg)` +
        `  qLabels=${r.questionLabels} opts=${r.optionLabels} printedAns=${r.printedAnswers}` +
        `${r.estQuestions !== null ? ` ~${r.estQuestions}Q` : ''}${r.arabic ? ' [arabic]' : ''}`,
    )
  }
}

if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify(rows, null, 2), 'utf8')
  console.log(`\nwrote ${jsonOut} (${rows.length} rows)`)
}
