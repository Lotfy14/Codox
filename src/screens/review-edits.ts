/**
 * Review edit layer (edit mode). Like resolutions, edits are the tutor's
 * own explicit corrections stored in a separate `review-edits` artifact —
 * the engine's `merged-rows` stays read-only history and edits are applied
 * deterministically at export. NEVER-GUESS is untouched: an edit only ever
 * carries what the tutor typed or picked; when an option removal orphans
 * an answer, deterministic remapping blanks it rather than guessing.
 *
 * Coordinates: every stored field is ABSOLUTE — `options`/`imageUrls`
 * replace the row's lists wholesale, `correctIndex` indexes the EDITED
 * options. A field is only stored when it differs from the row's baseline
 * (the pristine merged row, or the export-effective topic/subtopic/year),
 * so clearing an edit back to baseline removes it.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import type { AiAnswer } from '../engine/solver'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'

export interface RowEdit {
  question?: string
  /** Full replacement option list (add/remove/reword). */
  options?: string[]
  /** Extracted-answer override vs the EDITED options; '' = blanked. */
  correctIndex?: string
  topic?: string
  subtopic?: string
  year?: string
  /** Full replacement linked-picture list (bundle-relative crop paths). */
  imageUrls?: string[]
}

/** rowId → the tutor's edits for that row. */
export type Edits = Readonly<Record<string, RowEdit>>

// --------------------------------------------------------------- storage

export async function getEdits(runId: string): Promise<Edits> {
  const artifact = await getArtifact(runId, 'review-edits')
  return (artifact?.json as Record<string, RowEdit> | undefined) ?? {}
}

/** Live view of a run's row edits. undefined while loading. */
export function useEdits(runId: string): Edits | undefined {
  return useLiveQuery(() => getEdits(runId), [runId])
}

/** Stores one row's edit; `null` removes the row's edit entirely. */
export async function saveRowEdit(
  runId: string,
  rowId: string,
  edit: RowEdit | null,
): Promise<void> {
  const artifact = await getArtifact(runId, 'review-edits')
  const current = (artifact?.json as Record<string, RowEdit> | undefined) ?? {}
  const next = { ...current }
  if (edit === null) delete next[rowId]
  else next[rowId] = edit
  if (artifact === undefined) {
    await putArtifact({ runId, kind: 'review-edits', json: next })
    return
  }
  await db.runArtifacts.update(artifact.id, { json: next })
}

/**
 * Deterministically remaps one row's cached AI answer after an options
 * edit shifted indexes — same pick, new position; a removed option's pick
 * becomes null (blank beats stale). Only the index moves; solving stays
 * the solver's job and `merged-rows` is never touched.
 */
export async function updateAiAnswerIndex(
  runId: string,
  rowId: string,
  index: number | null,
): Promise<void> {
  const artifact = await getArtifact(runId, 'ai-answers')
  const json = artifact?.json as { answers?: Record<string, AiAnswer> } | undefined
  const answer = json?.answers?.[rowId]
  if (artifact === undefined || json?.answers === undefined || answer === undefined) return
  await db.runArtifacts.update(artifact.id, {
    json: {
      ...json,
      answers: { ...json.answers, [rowId]: { ...answer, index } },
    },
  })
}

// -------------------------------------------------------------- applying

/**
 * The tutor's content edits (question, options, answer override, linked
 * pictures) — applied BEFORE resolutions so a confirmed answer is always
 * validated against the options the tutor actually sees.
 */
export function applyContentEdits(
  rows: readonly MergedRow[],
  edits: Edits,
): MergedRow[] {
  return rows.map((row) => {
    const edit = edits[row.id]
    if (edit === undefined) return row
    return {
      ...row,
      question: edit.question ?? row.question,
      options: edit.options ?? row.options,
      correct_index: edit.correctIndex ?? row.correct_index,
      image_urls: edit.imageUrls ?? row.image_urls,
    }
  })
}

/**
 * The tutor's metadata edits (topic, subtopic, year) — applied AFTER
 * topic matches and the run's year mode, so an explicit edit always wins
 * over the matcher and the run-wide year.
 */
export function applyMetaEdits(
  rows: readonly MergedRow[],
  edits: Edits,
): MergedRow[] {
  return rows.map((row) => {
    const edit = edits[row.id]
    if (edit === undefined) return row
    return {
      ...row,
      topic: edit.topic ?? row.topic,
      subtopic: edit.subtopic ?? row.subtopic,
      year: edit.year ?? row.year,
    }
  })
}

/** True when any edit sets a topic or subtopic (forces the columns). */
export function editsSetTopic(edits: Edits): boolean {
  return Object.values(edits).some(
    (edit) =>
      (edit.topic !== undefined && edit.topic !== '') ||
      (edit.subtopic !== undefined && edit.subtopic !== ''),
  )
}

/** True when any edit sets a year (forces the column). */
export function editsSetYear(edits: Edits): boolean {
  return Object.values(edits).some(
    (edit) => edit.year !== undefined && edit.year !== '',
  )
}

// ------------------------------------------------------------- save plan

/** One option as the editor holds it: text plus where it came from. */
export interface EditorOption {
  text: string
  /** Index in the pre-edit (displayed) options; null = newly added. */
  originalIndex: number | null
}

export interface EditorForm {
  question: string
  options: readonly EditorOption[]
  /** Index into `options` the tutor marked correct; null = blank. */
  correctChoice: number | null
  topic: string
  subtopic: string
  year: string
  imageUrls: readonly string[]
}

/** The export-effective values a row shows WITHOUT an edit. */
export interface EditBaseline {
  topic: string
  subtopic: string
  year: string
}

export interface EditSavePlan {
  /** The stored edit, or null when everything is back to baseline. */
  edit: RowEdit | null
  resolution:
    | { kind: 'keep' }
    | { kind: 'set'; index: number }
    | { kind: 'clear' }
  /** Remapped AI answer index; undefined = leave the artifact alone. */
  aiIndex?: number | null
}

/** Where a pre-edit option landed after the edit; null = removed. */
function remapIndex(
  index: number,
  options: readonly EditorOption[],
): number | null {
  const next = options.findIndex((option) => option.originalIndex === index)
  return next === -1 ? null : next
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Pure save planner. `pristine` is the engine's merged row; `current` is
 * the row as displayed (pristine + any prior edit), which is what the
 * form's `originalIndex` values and the stored resolution refer to.
 */
export function planEditSave(
  pristine: MergedRow,
  current: MergedRow,
  form: EditorForm,
  baseline: EditBaseline,
  storedResolution: number | undefined,
  aiAnswer: AiAnswer | undefined,
): EditSavePlan {
  const newOptions = form.options.map((option) => option.text.trim())
  const structural =
    form.options.length !== current.options.length ||
    form.options.some((option, index) => option.originalIndex !== index)

  // Extracted answer follows its option: same pick, new position; a
  // removed option's pick becomes '' — blank beats stale (NEVER-GUESS).
  let extracted = current.correct_index
  if (structural && extracted !== '') {
    const moved = remapIndex(Number(extracted), form.options)
    extracted = moved === null ? '' : String(moved)
  }
  if (form.correctChoice === null && extracted !== '') extracted = ''

  const edit: RowEdit = {}
  const question = form.question.trim()
  if (question !== pristine.question) edit.question = question
  if (!sameList(newOptions, pristine.options)) edit.options = newOptions
  if (extracted !== pristine.correct_index) edit.correctIndex = extracted
  if (form.topic.trim() !== baseline.topic) edit.topic = form.topic.trim()
  if (form.subtopic.trim() !== baseline.subtopic) edit.subtopic = form.subtopic.trim()
  if (form.year.trim() !== baseline.year) edit.year = form.year.trim()
  if (!sameList(form.imageUrls, pristine.image_urls)) {
    edit.imageUrls = [...form.imageUrls]
  }

  let resolution: EditSavePlan['resolution']
  if (form.correctChoice === null) {
    resolution = storedResolution === undefined ? { kind: 'keep' } : { kind: 'clear' }
  } else if (storedResolution !== undefined) {
    // A stored resolution is a raw index into the final options, so it is
    // right exactly when it equals the marked choice's new position.
    resolution =
      storedResolution === form.correctChoice
        ? { kind: 'keep' }
        : { kind: 'set', index: form.correctChoice }
  } else {
    // No resolution: keep the extracted provenance when it already says
    // the same thing; otherwise the mark is a fresh explicit human pick.
    resolution =
      extracted !== '' && Number(extracted) === form.correctChoice
        ? { kind: 'keep' }
        : { kind: 'set', index: form.correctChoice }
  }

  const plan: EditSavePlan = {
    edit: Object.keys(edit).length === 0 ? null : edit,
    resolution,
  }
  if (structural && aiAnswer !== undefined && aiAnswer.index !== null) {
    const moved = remapIndex(aiAnswer.index, form.options)
    if (moved !== aiAnswer.index) plan.aiIndex = moved
  }
  return plan
}
