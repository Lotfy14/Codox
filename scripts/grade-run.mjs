/**
 * Score one (or several) cli-convert bundles so a prompt or step change can be
 * judged by numbers instead of by reading CSVs. Reads only what the run already
 * wrote to disk — no Gemini calls, no quota.
 *
 *   node scripts/grade-run.mjs "<bundle dir>" ["<bundle dir>" ...] [--json out.json]
 *
 * A bundle dir is what cli-convert.mjs writes: "<name> Cx/" containing the CSV
 * and debug/{blueprint-valid.json,execution-logs.json,artifacts/,pages/}.
 *
 * The headline numbers, in the order they matter:
 *   rows           — how many questions came out at all
 *   shortfall      — planner's own count minus rows emitted (negative = surplus,
 *                    which is not an error; see CLAUDE.md "Question count is
 *                    code-owned")
 *   answered       — rows shipping a correct_index
 *   flagged        — rows a tutor must fix by hand, by reason
 *   truncated      — rows whose option count is below the document's own mode,
 *                    the page-break defect's signature
 *   requests       — model calls made, because every one is the tutor's own
 *                    free-tier quota
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt === -1 ? null : args[jsonAt + 1]
const truthAt = args.indexOf('--truth')
const truthPath = truthAt === -1 ? null : args[truthAt + 1]
const flagValues = new Set([jsonOut, truthPath].filter(Boolean))
const bundles = args.filter((a) => !a.startsWith('--') && !flagValues.has(a))

if (bundles.length === 0) {
  console.error('usage: node scripts/grade-run.mjs "<bundle dir>" [...] [--json out.json]')
  process.exit(1)
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function histogram(values) {
  const out = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

/**
 * The document's own dominant option count — the norm a short row violates.
 * Mirrors `modalOptionCount` in src/engine/executor.ts deliberately, so this
 * grader's "below modal" means exactly what the engine's page-break repair
 * means. A Map (not an object) is required: JS objects iterate integer-like
 * keys in ascending numeric order, so a histogram object silently reports the
 * SMALLEST option count as the mode.
 */
const MIN_ROWS_FOR_OPTION_MODE = 4
function modalOptionCount(rows) {
  const counts = rows.map((r) => (Array.isArray(r.options) ? r.options.length : 0)).filter((n) => n >= 2)
  if (counts.length < MIN_ROWS_FOR_OPTION_MODE) return null
  const tally = new Map()
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1)
  let mode = 0
  let best = 0
  for (const [count, hits] of tally) {
    if (hits > best || (hits === best && count > mode)) {
      mode = count
      best = hits
    }
  }
  return best * 2 >= counts.length ? mode : null
}

/** Cheap near-duplicate key: a re-asked or double-counted question shows here. */
function normalizeQuestion(q) {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * Ground truth read off the source document by a human (or by reading the
 * renders): `{ "1": "B", "2": "A", … }` keyed by the PRINTED question label,
 * which is what the engine uses as a row id. Answer accuracy is the number
 * this whole exercise exists to move, and it cannot be derived from the run's
 * own output — a confident wrong answer looks exactly like a right one there.
 *
 * `wrong` is reported separately from `missed` and never averaged with it: a
 * blank goes to Review and costs the tutor a minute, a wrong answer ships.
 */
function scoreAgainstTruth(rows, truth) {
  const letters = 'ABCDEFGH'
  const out = { graded: 0, correct: 0, wrong: 0, missed: 0, notFound: 0, wrongList: [] }
  for (const [label, expected] of Object.entries(truth)) {
    const row = rows.find((r) => String(r.id) === String(label))
    if (!row) {
      out.notFound += 1
      continue
    }
    out.graded += 1
    const raw = String(row.correct_index ?? '').trim()
    if (raw === '') {
      out.missed += 1
      continue
    }
    const got = letters[Number(raw)]
    if (got === String(expected).trim().toUpperCase()) {
      out.correct += 1
    } else {
      out.wrong += 1
      out.wrongList.push({
        id: label,
        expected: String(expected).toUpperCase(),
        got: got ?? `idx${raw}`,
        gotText: row.options?.[Number(raw)] ?? '',
        question: String(row.question ?? '').slice(0, 70),
      })
    }
  }
  return out
}

async function grade(bundleDir) {
  const dir = path.resolve(bundleDir)
  const debug = path.join(dir, 'debug')
  const artDir = path.join(debug, 'artifacts')

  const report = { bundle: path.basename(dir) }

  const rows = (await readJson(path.join(artDir, 'merged-rows.json'))) ?? []
  const blueprint = await readJson(path.join(debug, 'blueprint-valid.json'))
  const logs = (await readJson(path.join(debug, 'execution-logs.json'))) ?? []
  const audit = await readJson(path.join(artDir, 'audit-report.json'))
  const reconcile = await readJson(path.join(artDir, 'index-reconcile.json'))

  if (rows.length === 0 && blueprint === null) {
    report.error = 'no merged-rows.json and no blueprint — did this run finish?'
    return report
  }

  // --- scale ---------------------------------------------------------------
  report.pages = blueprint?.document_profile?.page_count ?? null
  report.rows = rows.length
  const plannedCount = blueprint?.document_profile?.question_count ?? null
  report.plannerCount = plannedCount
  report.shortfall = plannedCount === null ? null : plannedCount - rows.length
  report.policy = blueprint?.document_profile?.answer_policy?.type ?? null

  // --- answers -------------------------------------------------------------
  const answered = rows.filter((r) => String(r.correct_index ?? '').trim() !== '')
  report.answered = answered.length
  report.answeredPct = rows.length === 0 ? 0 : Math.round((answered.length / rows.length) * 100)
  report.flagged = rows.filter((r) => (r.needs_review ?? '') !== '').length
  report.flagReasons = histogram(rows.map((r) => r.needs_review).filter((r) => (r ?? '') !== ''))

  // --- options -------------------------------------------------------------
  const optionCounts = rows.map((r) => (Array.isArray(r.options) ? r.options.length : 0))
  report.optionCounts = histogram(optionCounts)
  const modal = modalOptionCount(rows)
  report.modalOptionCount = modal
  report.underTwoOptions = optionCounts.filter((n) => n < 2).length
  // Below the document's own norm: the page-break truncation signature. Counted
  // separately from <2 because a 3-of-4 row looks complete and ships silently.
  report.belowModal = modal === null ? null : optionCounts.filter((n) => n >= 2 && n < modal).length
  report.emptyOptionText = rows.filter((r) => (r.options ?? []).some((o) => String(o).trim() === '')).length
  report.duplicateOptionText = rows.filter(
    (r) => new Set((r.options ?? []).map((o) => String(o).trim().toLowerCase())).size < (r.options ?? []).length,
  ).length

  // --- question text -------------------------------------------------------
  report.emptyQuestions = rows.filter((r) => String(r.question ?? '').trim() === '').length
  report.shortQuestions = rows.filter((r) => {
    const len = String(r.question ?? '').trim().length
    return len > 0 && len < 15
  }).length
  // Formatting leakage: code owns assembly, so these strings must never appear.
  report.labelLeak = rows.filter((r) => /^(case stem:|question:)/i.test(String(r.question ?? '').trim())).length
  report.numberLeak = rows.filter((r) => /^\s*\(?\d{1,3}\s*[.)-]/.test(String(r.question ?? ''))).length
  const keys = rows.map((r) => normalizeQuestion(String(r.question ?? '')))
  const dupes = histogram(keys.filter((k) => k !== ''))
  report.duplicateQuestions = Object.values(dupes).filter((n) => n > 1).reduce((a, n) => a + (n - 1), 0)

  // --- images --------------------------------------------------------------
  report.rowsWithImages = rows.filter((r) => (r.image_urls ?? []).length > 0).length
  try {
    const imgs = await readdir(path.join(dir, 'images'))
    report.cropFiles = imgs.length
  } catch {
    report.cropFiles = 0
  }

  // --- audit ---------------------------------------------------------------
  if (audit) {
    report.auditPass = audit.audit_pass ?? null
    report.auditRisk = audit.risk_class ?? null
    report.auditFailedRows = (audit.failed_rows ?? []).length
    report.auditFailFields = histogram((audit.failed_rows ?? []).map((f) => f.field))
    report.auditGlobal = (audit.global_failures ?? []).length
  }

  // --- planning issues -----------------------------------------------------
  if (reconcile) {
    report.indexIssues = histogram((reconcile.issues ?? []).map((i) => i.kind))
  }

  // --- cost and health -----------------------------------------------------
  const events = histogram(logs.map((l) => l.event).filter(Boolean))
  report.logEvents = events
  report.errors = logs.filter((l) => l.level === 'error').length
  report.warns = logs.filter((l) => l.level === 'warn').length
  // Every artifact named chunk-request is one worker call; index/figure windows
  // and box pages are one call each too. Counted from artifacts because that is
  // what the run actually wrote.
  try {
    const artifacts = await readdir(artDir)
    report.workerChunks = artifacts.filter((f) => f.startsWith('chunk-request')).length
    report.indexWindows = artifacts.filter((f) => f.startsWith('index-window')).length
    report.figureWindows = artifacts.filter((f) => f.startsWith('figure-window')).length
  } catch {
    /* no artifacts dir */
  }
  const timings = logs.filter((l) => l.event === 'engine.timing')
  if (timings.length > 0) {
    report.timingMs = Object.fromEntries(
      timings.map((t) => [t.detail?.step ?? t.step ?? '?', t.detail?.ms ?? t.ms ?? null]),
    )
  }
  const first = logs.reduce((m, l) => Math.min(m, l.t ?? Infinity), Infinity)
  const last = logs.reduce((m, l) => Math.max(m, l.t ?? 0), 0)
  report.durationMin = Number.isFinite(first) && last > 0 ? +(((last - first) / 60000).toFixed(1)) : null

  return report
}

function line(label, value) {
  if (value === null || value === undefined) return
  if (typeof value === 'object' && Object.keys(value).length === 0) return
  const shown = typeof value === 'object' ? JSON.stringify(value) : value
  console.log(`  ${label.padEnd(20)} ${shown}`)
}

let truth = null
if (truthPath) {
  const loaded = await readJson(path.resolve(truthPath))
  if (loaded === null) {
    console.error(`could not read truth file: ${truthPath}`)
    process.exit(1)
  }
  truth = loaded.answers ?? loaded
}

const reports = []
for (const b of bundles) {
  const r = await grade(b)
  if (truth) {
    const rows = (await readJson(path.join(path.resolve(b), 'debug', 'artifacts', 'merged-rows.json'))) ?? []
    r.accuracy = scoreAgainstTruth(rows, truth)
  }
  reports.push(r)
  console.log(`\n=== ${r.bundle} ===`)
  if (r.error) {
    console.log(`  ${r.error}`)
    continue
  }
  line('pages', r.pages)
  line('rows', `${r.rows}${r.shortfall ? `  (planner said ${r.plannerCount}, shortfall ${r.shortfall})` : ''}`)
  line('policy', r.policy)
  line('answered', `${r.answered} / ${r.rows}  (${r.answeredPct}%)`)
  line('flagged', r.flagged)
  line('flag reasons', r.flagReasons)
  line('option counts', r.optionCounts)
  line('below modal', r.modalOptionCount === null ? 'n/a (no norm)' : `${r.belowModal}  (norm ${r.modalOptionCount})`)
  line('<2 options', r.underTwoOptions)
  line('empty questions', r.emptyQuestions)
  line('dup questions', r.duplicateQuestions)
  line('label leak', r.labelLeak || null)
  line('number leak', r.numberLeak || null)
  line('empty opt text', r.emptyOptionText || null)
  line('dup opt text', r.duplicateOptionText || null)
  line('rows w/ images', `${r.rowsWithImages}  (${r.cropFiles} crop files)`)
  if (r.auditRisk) line('audit', `${r.auditRisk}  failedRows=${r.auditFailedRows} global=${r.auditGlobal} ${JSON.stringify(r.auditFailFields)}`)
  line('index issues', r.indexIssues)
  line('calls', `index=${r.indexWindows ?? '?'} figure=${r.figureWindows ?? '?'} worker=${r.workerChunks ?? '?'}`)
  line('errors/warns', `${r.errors} / ${r.warns}`)
  line('duration', r.durationMin === null ? null : `${r.durationMin}m`)
  if (r.accuracy) {
    const a = r.accuracy
    const pct = a.graded === 0 ? 0 : Math.round((a.correct / a.graded) * 100)
    line('ACCURACY', `${a.correct} right / ${a.wrong} WRONG / ${a.missed} blank  of ${a.graded} graded  (${pct}% right)`)
    if (a.notFound > 0) line('  not extracted', a.notFound)
    for (const w of a.wrongList) {
      console.log(`      #${w.id} expected ${w.expected}, got ${w.got} "${w.gotText}"  — ${w.question}`)
    }
  }
}

if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify(reports, null, 2), 'utf8')
  console.log(`\nwrote ${jsonOut}`)
}
