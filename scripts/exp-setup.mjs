// Experiment scaffolding: build isolated, identical copies of an already-prepared
// bundle so several /convert runs can be graded against each other.
//
//   node scripts/exp-setup.mjs <reference-exam-dir> <variant> [variant...]
//
// Each variant gets the reference's rendered pages and source PDF, plus a blank
// exam.json scaffold. Extracted content (questions, figures, images) is stripped,
// so every variant starts from exactly the same place and does the real work.

import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import path from 'node:path'

const [refArg, ...variants] = process.argv.slice(2)

if (!refArg || variants.length === 0) {
  console.error('usage: node scripts/exp-setup.mjs <reference-exam-dir> <variant> [variant...]')
  process.exit(1)
}

const refDir = path.resolve(refArg)
const expRoot = path.resolve('agent-conversion/output/_experiment')

const scaffold = JSON.parse(await readFile(path.join(refDir, 'exam.json'), 'utf8'))
const referenceQuestionCount = scaffold.questions?.length ?? 0

if (referenceQuestionCount === 0) {
  console.error(`refusing to run: ${refArg} has no extracted questions, so it cannot serve as a reference`)
  process.exit(1)
}

// The scaffold keeps only what agent-prepare.mjs would have produced.
const blank = {
  codoxAgentBundle: scaffold.codoxAgentBundle,
  sourceFile: scaffold.sourceFile,
  producedBy: '',
  pages: scaffold.pages,
  figures: [],
  topics: [],
  questions: [],
}

for (const variant of variants) {
  const dest = path.join(expRoot, variant, path.basename(refDir))
  await rm(dest, { recursive: true, force: true })
  await mkdir(path.join(dest, 'images'), { recursive: true })

  await cp(path.join(refDir, 'pages'), path.join(dest, 'pages'), { recursive: true })
  await cp(path.join(refDir, 'exam.pdf'), path.join(dest, 'exam.pdf')).catch(() => {})
  await writeFile(path.join(dest, 'exam.json'), `${JSON.stringify(blank, null, 2)}\n`)

  console.log(`ready  ${path.relative(process.cwd(), dest)}`)
}

console.log(`
Reference: ${path.relative(process.cwd(), refDir)} (${referenceQuestionCount} questions)
Prepared ${variants.length} variant${variants.length === 1 ? '' : 's'}, ${blank.pages.length} pages each.

Run ONE variant per session, setting session effort/thinking first, then:
  /convert agent-conversion/output/_experiment/<variant>/${path.basename(refDir)}

Time it from the session, and grade with:
  node scripts/exp-grade.mjs ${JSON.stringify(path.relative(process.cwd(), refDir))} <variant-exam-dir>
`)
