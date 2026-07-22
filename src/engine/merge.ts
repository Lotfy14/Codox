/**
 * Worker-chunk validation and the deterministic merge (§1.4/§1.5/§1.7) —
 * pure functions, and the place NEVER-GUESS is code:
 *
 * - The worker's `needs_review` is ALWAYS discarded.
 * - Blank `correct_index` is never defaulted; a policy that forbids
 *   answers forces blanks even over a filled worker value.
 * - Every planner-owned field is taken from the blueprint, never the
 *   worker response.
 */
import { isRecord, isStringArray, parseModelJson } from './json'
import { stripLeadingQuestionLabel } from './normalize'
import {
  EVIDENCE_POLICY_TYPES,
  type Blueprint,
  type MergedRow,
  type PlannedRow,
  type WorkerRow,
} from './types'

/** Fields the planner owns; the worker must echo them unchanged (§1.4). */
const PLANNER_OWNED = ['id', 'group_id', 'topic', 'subtopic', 'year'] as const

export type ChunkValidation =
  | { ok: true; rows: WorkerRow[] }
  | { ok: false; errors: string[] }

/**
 * Gate for one worker chunk response (§1.3 step 5): valid JSON, a `rows`
 * array, exactly the requested row IDs in exactly the requested order, no
 * planner-owned changes. `expected` is the chunk's planned rows in order.
 */
export function validateWorkerChunk(
  responseText: string,
  expected: readonly PlannedRow[],
): ChunkValidation {
  const errors: string[] = []
  const parsed = parseModelJson(responseText)
  if (parsed.error !== undefined) {
    return { ok: false, errors: [`response is not valid JSON: ${parsed.error}`] }
  }
  if (!isRecord(parsed.value) || !Array.isArray(parsed.value.rows)) {
    return { ok: false, errors: ['response has no "rows" array'] }
  }
  const rawRows = parsed.value.rows

  if (rawRows.length !== expected.length) {
    errors.push(
      `expected ${expected.length} rows, got ${rawRows.length}`,
    )
  }

  const rows: WorkerRow[] = []
  for (let i = 0; i < Math.min(rawRows.length, expected.length); i += 1) {
    const raw = rawRows[i]
    const planned = expected[i]
    if (!isRecord(raw)) {
      errors.push(`row ${i} is not an object`)
      continue
    }
    if (raw.id !== planned.id) {
      errors.push(
        `row ${i}: expected id "${planned.id}", got "${String(raw.id)}" (no additions, removals, or reordering)`,
      )
      continue
    }
    for (const field of PLANNER_OWNED) {
      if (typeof raw[field] !== 'string' || raw[field] !== planned[field]) {
        errors.push(
          `row "${planned.id}": planner-owned field "${field}" was changed`,
        )
      }
    }
    if (
      !isStringArray(raw.image_urls) ||
      raw.image_urls.length !== planned.image_urls.length ||
      raw.image_urls.some((url, j) => url !== planned.image_urls[j])
    ) {
      errors.push(
        `row "${planned.id}": planner-owned field "image_urls" was changed`,
      )
    }
    if (typeof raw.question !== 'string') {
      errors.push(`row "${planned.id}": "question" must be a string`)
    }
    // case_stem is tolerated as absent: standalone rows omit it, and a
    // pre-change checkpoint (which had no field) narrows to '' unharmed.
    if (raw.case_stem !== undefined && typeof raw.case_stem !== 'string') {
      errors.push(`row "${planned.id}": "case_stem" must be a string`)
    }
    if (!isStringArray(raw.options)) {
      errors.push(`row "${planned.id}": "options" must be an array of strings`)
    }
    const correctIndex = raw.correct_index
    if (typeof correctIndex !== 'string' && typeof correctIndex !== 'number') {
      errors.push(
        `row "${planned.id}": "correct_index" must be a string or number`,
      )
    }
    if (errors.length > 0) continue
    rows.push({
      id: planned.id,
      group_id: planned.group_id,
      topic: planned.topic,
      subtopic: planned.subtopic,
      year: planned.year,
      case_stem: typeof raw.case_stem === 'string' ? raw.case_stem : '',
      question: raw.question as string,
      options: raw.options as string[],
      correct_index: String(correctIndex ?? ''),
      image_urls: [...planned.image_urls],
      needs_review:
        typeof raw.needs_review === 'string' ? raw.needs_review : '',
    })
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows }
}

/**
 * Deterministic question assembly (owner-approved 2026-07-15, §2.2): the
 * worker now hands us the shared stem and the individual prompt as two
 * verbatim fields. Code — not the weakest model — strips each part's printed
 * number and fills the blueprint's code-owned `final_format` template. A
 * case-mode row whose stem came back empty degrades to the prompt alone
 * rather than emitting a dangling "\n\n" header.
 */
function assembleQuestion(planned: PlannedRow, worker: WorkerRow): string {
  const prompt = stripLeadingQuestionLabel(worker.question)
  const template = planned.question_assembly.final_format
  const wantsCase = template.includes('{case_stem}')
  if (!wantsCase) return prompt
  const stem = stripLeadingQuestionLabel(worker.case_stem)
  if (stem.trim() === '') return prompt
  return template
    .replace('{case_stem}', stem)
    .replace('{question_prompt}', prompt)
}

/** True when the per-row planner policy forces a blank answer (§1.5). */
function rowPolicyForcesBlank(row: PlannedRow): boolean {
  return (
    row.correct_index_policy.needs_review !== '' ||
    row.correct_index_policy.type.startsWith('blank')
  )
}

interface ForcedAnswer {
  correct_index: string
  needs_review: string
}

/**
 * Answer-policy forcing for one row (§1.5) — deterministic, applied at
 * merge regardless of what the worker emitted.
 */
function forceAnswer(
  planned: PlannedRow,
  policyType: Blueprint['document_profile']['answer_policy']['type'],
  workerValue: string,
  optionCount: number,
): ForcedAnswer {
  // Document policy forbids answers outright.
  if (policyType === 'no_answer_key' || policyType === 'uncertain') {
    return { correct_index: '', needs_review: policyType }
  }
  // Evidence exists at document level, but this row's planner policy
  // forces blank (conflicting marks, illegible key, mixed-policy row
  // without evidence, …) — the planner's per-row reason wins.
  if (rowPolicyForcesBlank(planned)) {
    return {
      correct_index: '',
      needs_review:
        planned.correct_index_policy.needs_review !== ''
          ? planned.correct_index_policy.needs_review
          : policyType,
    }
  }
  // Policy permits extraction; the worker left it blank → keep it blank.
  if (workerValue.trim() === '') {
    return { correct_index: '', needs_review: 'no_visible_answer' }
  }
  // Policy permits extraction and the worker filled it: accept only a
  // valid 0-based index into this row's options.
  if (!/^\d+$/.test(workerValue.trim())) {
    return { correct_index: '', needs_review: 'key_unclear' }
  }
  const index = Number.parseInt(workerValue.trim(), 10)
  if (index < 0 || index >= optionCount) {
    return { correct_index: '', needs_review: 'index_out_of_range' }
  }
  return { correct_index: String(index), needs_review: '' }
}

export type MergeResult =
  | { ok: true; rows: MergedRow[] }
  | { ok: false; errors: string[] }

/**
 * Merges validated worker rows into the planner's row skeletons under the
 * §1.4 ownership table. Row set and order come from the blueprint; the
 * worker contributes only `question`, `options`, and (policy permitting)
 * `correct_index`. Gate: every planned row has exactly one worker row.
 */
export function mergeRows(
  blueprint: Blueprint,
  workerRows: readonly WorkerRow[],
): MergeResult {
  const errors: string[] = []
  const byId = new Map<string, WorkerRow>()
  for (const row of workerRows) {
    if (byId.has(row.id)) errors.push(`duplicate worker row id "${row.id}"`)
    byId.set(row.id, row)
  }
  for (const row of workerRows) {
    if (!blueprint.planned_rows.some((planned) => planned.id === row.id)) {
      errors.push(`worker row id "${row.id}" is not in the blueprint`)
    }
  }

  const policyType = blueprint.document_profile.answer_policy.type
  const rows: MergedRow[] = []
  for (const planned of blueprint.planned_rows) {
    const worker = byId.get(planned.id)
    if (worker === undefined) {
      errors.push(`no worker row for planned row "${planned.id}"`)
      continue
    }
    const forced = forceAnswer(
      planned,
      policyType,
      worker.correct_index,
      worker.options.length,
    )
    // Codox ships MCQs only: a row with fewer than two options can never be
    // a valid Triviadox question, so code flags it for the tutor instead of
    // shipping a blank-option "question". NEVER-GUESS holds — the answer is
    // forced blank, nothing is invented; the tutor decides in review whether
    // to edit it into an MCQ or delete it. This takes precedence over the
    // policy reason: "not a multiple-choice question" is the actionable one.
    const isMcq = worker.options.length >= 2
    rows.push({
      id: planned.id,
      group_id: planned.group_id,
      topic: planned.topic,
      subtopic: planned.subtopic,
      year: planned.year,
      question: assembleQuestion(planned, worker),
      options: [...worker.options],
      correct_index: isMcq ? forced.correct_index : '',
      // The worker's needs_review was discarded during chunk narrowing;
      // this value is policy/code-owned only.
      needs_review: isMcq ? forced.needs_review : 'not_mcq',
      image_urls: [...planned.image_urls],
    })
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows }
}

/**
 * The wrong-declaration degrade (BUILD_PLAN): every answer blank, every
 * row flagged. Never wrong rows — everything goes to human review.
 */
export function forceAllRowsBlankFlagged(
  rows: readonly MergedRow[],
  reason: string,
): MergedRow[] {
  return rows.map((row) => ({
    ...row,
    correct_index: '',
    needs_review: reason,
  }))
}

/** Whether the document policy claims visible answer evidence exists. */
export function policyClaimsEvidence(
  policyType: Blueprint['document_profile']['answer_policy']['type'],
): boolean {
  return EVIDENCE_POLICY_TYPES.includes(policyType)
}
