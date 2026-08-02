// Score one /convert run against a trusted reference extraction of the same exam.
//
//   node scripts/exp-grade.mjs <reference-exam-dir> <variant-exam-dir> [variant-exam-dir...]
//
// The reference's answers came from the published mark scheme, so answer
// agreement is graded as right/wrong, not merely "different". A WRONG answer is
// the headline number: under NEVER-GUESS a blank is acceptable and a confident
// error is not, so the two are counted separately and never averaged together.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { tokensByVariant } from './exp-tokens.mjs'

// Duration comes from the _run.json stamp written by exp-start.mjs and
// exam.json's mtime (the converting agent's last write).
async function durationOf(dir) {
  try {
    const run = JSON.parse(await readFile(path.join(path.resolve(dir), '_run.json'), 'utf8'))
    const end = (await stat(path.join(path.resolve(dir), 'exam.json'))).mtime
    const mins = (end.getTime() - new Date(run.startedAt).getTime()) / 60000
    return mins > 0 ? `${mins.toFixed(1)}m` : '?'
  } catch {
    return '-'
  }
}

const [refArg, ...variantArgs] = process.argv.slice(2)

if (!refArg || variantArgs.length === 0) {
  console.error('usage: node scripts/exp-grade.mjs <reference-exam-dir> <variant-exam-dir> [...]')
  process.exit(1)
}

// Fold typographic punctuation before comparing: a run that writes Benedict's
// where the reference wrote Benedict’s transcribed the same printed text, and
// scoring that as a miss would rank runs by apostrophe style rather than by
// extraction quality.
const norm = (s) =>
  String(s ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t.length > 2))

function similarity(a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared += 1
  return shared / Math.max(ta.size, tb.size)
}

const load = async (dir) => JSON.parse(await readFile(path.join(path.resolve(dir), 'exam.json'), 'utf8'))

// Greedy best-match alignment: a variant may miss, add, or reorder questions,
// so aligning by array position would mis-score everything after a single gap.
function align(refQuestions, varQuestions) {
  const pool = varQuestions.map((q, i) => ({ q, i }))
  const pairs = []
  const missed = []

  for (const ref of refQuestions) {
    let best = null
    let bestScore = 0
    for (const cand of pool) {
      const score = similarity(ref.question, cand.q.question)
      if (score > bestScore) {
        bestScore = score
        best = cand
      }
    }
    if (best && bestScore >= 0.5) {
      pairs.push({ ref, got: best.q, score: bestScore })
      pool.splice(pool.indexOf(best), 1)
    } else {
      missed.push(ref)
    }
  }
  return { pairs, missed, spurious: pool.map((p) => p.q) }
}

const reference = await load(refArg)

console.log(`reference: ${path.basename(path.resolve(refArg))} — ${reference.questions.length} questions\n`)

const rows = []

for (const variantArg of variantArgs) {
  const variant = await load(variantArg)
  const { pairs, missed, spurious } = align(reference.questions, variant.questions)

  let textExact = 0
  let optionsExact = 0
  let pageExact = 0
  let answerRight = 0
  let answerWrong = 0
  let answerBlank = 0
  let gradable = 0

  // A question the reference illustrated but this run did not is a real defect:
  // a table or diagram question is unanswerable without its picture.
  let figMissing = 0

  for (const { ref, got } of pairs) {
    if (norm(ref.question) === norm(got.question)) textExact += 1

    if ((ref.figures ?? []).length > 0 && (got.figures ?? []).length === 0) figMissing += 1

    const refOpts = (ref.options ?? []).map(norm)
    const gotOpts = (got.options ?? []).map(norm)
    if (refOpts.length === gotOpts.length && refOpts.every((o, i) => o === gotOpts[i])) optionsExact += 1

    if (ref.page === got.page) pageExact += 1

    // Only grade answers the reference actually read off the page.
    if (ref.answer?.source === 'extracted' && Number.isInteger(ref.answer.index)) {
      gradable += 1
      const gotIndex = got.answer?.index
      const gotSource = got.answer?.source
      if (gotSource === 'extracted' && Number.isInteger(gotIndex)) {
        if (gotIndex === ref.answer.index) answerRight += 1
        else answerWrong += 1
      } else {
        answerBlank += 1
      }
    }
  }

  // The reference predates the `box` requirement, so this is coverage (did the
  // run emit a plausible box at all), not accuracy against a known-good box.
  const boxed = variant.questions.filter((q) => Array.isArray(q.box) && q.box.length === 4).length

  const figures = variant.questions.filter((q) => (q.figures ?? []).length > 0).length
  const flagged = variant.questions.filter((q) => q.flag).length
  const reasoned = variant.questions.filter((q) => q.answer?.source === 'reasoned').length

  rows.push({
    variant: path.basename(path.dirname(path.resolve(variantArg))),
    took: await durationOf(variantArg),
    found: variant.questions.length,
    matched: pairs.length,
    missed: missed.length,
    spurious: spurious.length,
    textExact,
    optionsExact,
    pageExact,
    answerRight,
    answerWrong,
    answerBlank,
    gradable,
    boxed,
    figMissing,
    figures,
    reasoned,
    flagged,
  })

  if (missed.length) {
    console.log(`  ${path.basename(path.dirname(path.resolve(variantArg)))} missed:`)
    for (const m of missed) console.log(`    - p${m.page} ${String(m.question).slice(0, 70)}`)
  }
}

const pct = (n, d) => (d === 0 ? '  n/a' : `${String(Math.round((n / d) * 100)).padStart(3)}%`)
const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

const usage = await tokensByVariant(rows.map((r) => r.variant))
for (const r of rows) {
  const t = usage.get(r.variant)
  r.out = t ? kilo(t.output) : '-'
  r.in = t ? kilo(t.input + t.cacheWrite + t.cacheRead) : '-'
  // Prefer the transcript's prompt-to-done span; it excludes the time between
  // stamping and actually typing /convert.
  if (t?.runMinutes != null) r.took = `${t.runMinutes.toFixed(1)}m`
  r.model = t ? t.model.replace(/^claude-/, '').replace(/-\d{8}$/, '') : '-'
  r.think = t ? (t.thinkingBlocks > 0 ? `yes(${t.thinkingBlocks})` : 'no') : '-'
}

console.log(
  '\nvariant           model          think     took   out-tok   in-tok  found  missed  text  opts  page   ANSWER right/wrong/blank   box  fig-miss  flags',
)
console.log('-'.repeat(156))
for (const r of rows) {
  console.log(
    `${r.variant.padEnd(17)}` +
      `${String(r.model).padEnd(15)}` +
      `${String(r.think).padEnd(8)}` +
      `${String(r.took).padStart(7)}` +
      `${String(r.out).padStart(10)}` +
      `${String(r.in).padStart(9)}` +
      `${String(r.found).padStart(5)}` +
      `${String(r.missed).padStart(8)}` +
      `${pct(r.textExact, r.matched).padStart(6)}` +
      `${pct(r.optionsExact, r.matched).padStart(6)}` +
      `${pct(r.pageExact, r.matched).padStart(6)}` +
      `${String(r.answerRight).padStart(11)}/${r.answerWrong}/${r.answerBlank}` +
      ` of ${String(r.gradable).padStart(3)}` +
      `${String(r.boxed).padStart(5)}` +
      `${String(r.figMissing).padStart(10)}` +
      `${String(r.flagged).padStart(7)}`,
  )
}

console.log(`
text/opts/page = share of matched questions transcribed exactly as the reference.
ANSWER counts only questions the reference read off the page.
  right  = same option as the mark scheme
  wrong  = confidently different  <- the number that matters; should be 0
  blank  = left unanswered or marked 'reasoned' (safe under NEVER-GUESS)
box  = questions carrying a 4-number box. Coverage only — the reference has no
       boxes to check against, so tightness still needs an eye on the crops.
out-tok = tokens generated, deduplicated by message id. This is the number that
       moves with thinking/effort. in-tok folds in cache reads, which are cheap,
       so it tracks document size far more than it tracks the setting.
`)
