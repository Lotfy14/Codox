/**
 * Review data layer. The engine's merged rows are read-only history; a
 * review resolution is the user's own answer, stored separately
 * (`review-resolutions` artifact) and applied deterministically at export.
 * Row edits (edit mode) follow the same pattern in their own
 * `review-edits` artifact — see `review-edits.ts`. NEVER-GUESS stays
 * intact: only an explicit human pick ever fills a blank `correct_index`.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { assetJpegPath } from '../engine/blueprint'
import { parentRowId } from '../engine/matching'
import type { Blueprint, Box2d, MergedRow, PlannedRow } from '../engine/types'
import type { AiAnswer } from '../engine/solver'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'
import {
  applyContentEdits,
  applyMetaEdits,
  getEdits,
  type Edits,
} from './review-edits'

/** The four tutor-facing flag explanations (reviewMessages.whyFlagged). */
export type FlagCategory =
  | 'blank-answer'
  | 'conflicting-marks'
  | 'length-mismatch'
  | 'low-confidence'

/** A figure the planner linked to this question (its own page + box). */
export interface ReviewFigure {
  /** 0-based page index of the figure's source region. */
  pageIndex: number
  /** The figure's region on that page (normalized 0–1000). */
  box: Box2d
}

export interface ReviewRow {
  row: MergedRow
  /** 1-based position among the run's rows — the tutor's question number. */
  questionNumber: number
  category: FlagCategory | null
  /** 0-based page index of the row's source region, if the planner had one. */
  pageIndex: number | null
  /** Union of the row's regions on that page (normalized 0–1000), padded. */
  box: Box2d | null
  /** Figures the planner linked to this row, in blueprint order. */
  figures: readonly ReviewFigure[]
}

export interface ReviewData {
  rows: MergedRow[]
  reviewRows: ReviewRow[]
  /** Blueprint figure regions by bundle crop path — edit mode's picker. */
  figureByPath: Record<string, ReviewFigure>
}

export function flaggedRows(data: ReviewData): ReviewRow[] {
  return data.reviewRows.filter((row) => row.category !== null)
}

/**
 * Machine reason → tutor category. The reasons are free-ish text (planner
 * per-row reasons plus merge's fixed vocabulary), so this matches on
 * substrings and falls back to the honest default: no answer was found.
 */
export function flagCategory(reason: string, correctIndex: string): FlagCategory {
  const text = reason.toLowerCase()
  if (text.includes('conflict') || text.includes('multiple_mark')) {
    return 'conflicting-marks'
  }
  if (text.includes('label') || text.includes('option') || text.includes('length')) {
    return 'length-mismatch'
  }
  if (
    text.includes('unclear') ||
    text.includes('illegible') ||
    text.includes('unreadable') ||
    text.includes('empty') ||
    text.includes('low_confidence') ||
    correctIndex !== ''
  ) {
    return 'low-confidence'
  }
  return 'blank-answer'
}

/** A row needs review when its answer is blank or a reason is recorded. */
export function isFlagged(row: MergedRow): boolean {
  return row.correct_index === '' || row.needs_review !== ''
}

/** Union of the row's planner regions that sit on one page, padded ~3%. */
function sourceRegion(
  plannedRows: ReadonlyMap<string, PlannedRow>,
  rowId: string,
): { pageIndex: number | null; box: Box2d | null } {
  // A split matching row (`12~m2`) has no blueprint entry of its own — it
  // came out of row `12` after the audit — so fall back to its parent's
  // region. Without this the tutor loses the source crop on exactly the
  // rows that most need checking.
  const planned = plannedRows.get(rowId) ?? plannedRows.get(parentRowId(rowId))
  if (planned === undefined) return { pageIndex: null, box: null }
  // The crop shows the QUESTION, never the answer: answer_evidence is left out
  // of the union on purpose. An on-page answer's region is the whole page, and
  // including it would both blow up the crop and reveal the answer inside the
  // question preview. The tutor sees the prompt, options, and case stem only.
  const regions = [
    planned.regions.question_prompt,
    planned.regions.options,
    planned.regions.case_stem,
  ].filter((region) => region !== null)
  const first = regions[0]
  if (first === undefined) return { pageIndex: null, box: null }
  const samePage = regions.filter((region) => region.page === first.page)
  let [ymin, xmin, ymax, xmax] = samePage[0].box_2d
  for (const region of samePage) {
    ymin = Math.min(ymin, region.box_2d[0])
    xmin = Math.min(xmin, region.box_2d[1])
    ymax = Math.max(ymax, region.box_2d[2])
    xmax = Math.max(xmax, region.box_2d[3])
  }
  const pad = 30 // ~3% of the 0–1000 page, so the crop breathes a little
  return {
    pageIndex: first.page - 1,
    box: [
      Math.max(0, ymin - pad),
      Math.max(0, xmin - pad),
      Math.min(1000, ymax + pad),
      Math.min(1000, xmax + pad),
    ],
  }
}

/** Loads a finished run's rows and a review row for every question. */
export async function loadReviewData(runId: string): Promise<ReviewData> {
  const merged = await getArtifact(runId, 'merged-rows')
  const blueprintArtifact = await getArtifact(runId, 'blueprint-valid')
  const rows = (merged?.json as MergedRow[] | undefined) ?? []
  const blueprint = blueprintArtifact?.json as Blueprint | undefined
  const plannedRows = new Map(
    (blueprint?.planned_rows ?? []).map((row) => [row.id, row]),
  )
  const figuresByRow = new Map<string, ReviewFigure[]>()
  const figureByPath: Record<string, ReviewFigure> = {}
  for (const asset of blueprint?.assets ?? []) {
    if (asset.page < 1) continue
    const figure: ReviewFigure = { pageIndex: asset.page - 1, box: asset.box_2d }
    figureByPath[assetJpegPath(asset.output_path)] = figure
    for (const rowId of asset.linked_row_ids) {
      const list = figuresByRow.get(rowId)
      if (list === undefined) figuresByRow.set(rowId, [figure])
      else list.push(figure)
    }
  }
  const reviewRows = rows.map((row, index) => {
    const { pageIndex, box } = sourceRegion(plannedRows, row.id)
    return {
      row,
      questionNumber: index + 1,
      category: isFlagged(row)
        ? flagCategory(row.needs_review, row.correct_index)
        : null,
      pageIndex,
      box: box,
      figures: figuresByRow.get(row.id) ?? [],
    }
  })
  return { rows, reviewRows, figureByPath }
}

/**
 * The review rows as the tutor sees them: content and metadata edits
 * applied, the flag category recomputed against the edited row, and
 * linked figures following an edited picture list. The underlying
 * `merged-rows` artifact stays pristine.
 */
export function applyEditsToReviewRows(
  reviewRows: readonly ReviewRow[],
  edits: Edits,
  figureByPath: Record<string, ReviewFigure>,
): ReviewRow[] {
  return reviewRows.map((reviewRow) => {
    const edit = edits[reviewRow.row.id]
    if (edit === undefined) return reviewRow
    const [row] = applyMetaEdits(
      applyContentEdits([reviewRow.row], edits),
      edits,
    )
    return {
      ...reviewRow,
      row,
      category: isFlagged(row)
        ? flagCategory(row.needs_review, row.correct_index)
        : null,
      figures:
        edit.imageUrls === undefined
          ? reviewRow.figures
          : edit.imageUrls.flatMap((path) =>
              figureByPath[path] === undefined ? [] : [figureByPath[path]],
            ),
    }
  })
}

/** rowId → the option index the tutor confirmed. */
export type Resolutions = Readonly<Record<string, number>>

/** The visible answer after applying a valid explicit human override. */
export function effectiveAnswer(
  row: ReviewRow,
  resolutions: Resolutions,
): number | null {
  const pick = resolutions[row.row.id]
  if (
    pick !== undefined &&
    Number.isInteger(pick) &&
    pick >= 0 &&
    pick < row.row.options.length
  ) {
    return pick
  }
  const enginePick = Number(row.row.correct_index)
  return row.row.correct_index !== '' &&
    Number.isInteger(enginePick) &&
    enginePick >= 0 &&
    enginePick < row.row.options.length
    ? enginePick
    : null
}

export async function getResolutions(runId: string): Promise<Resolutions> {
  const artifact = await getArtifact(runId, 'review-resolutions')
  return (artifact?.json as Record<string, number> | undefined) ?? {}
}

/** Live view of a run's confirmed answers. undefined while loading. */
export function useResolutions(runId: string): Resolutions | undefined {
  return useLiveQuery(() => getResolutions(runId), [runId])
}

export async function getAiAnswers(runId: string): Promise<Record<string, AiAnswer>> {
  const artifact = await getArtifact(runId, 'ai-answers')
  const json = artifact?.json as { answers?: Record<string, AiAnswer> } | undefined
  return json?.answers ?? {}
}

/** Live view of a run's AI-solved answers. undefined while loading. */
export function useAiAnswers(runId: string): Record<string, AiAnswer> | undefined {
  return useLiveQuery(() => getAiAnswers(runId), [runId])
}

export type AnswerSource = 'human' | 'extracted' | 'ai' | 'none'

export function answerSource(
  row: ReviewRow,
  resolutions: Resolutions,
  aiAnswers?: Record<string, AiAnswer>,
): { index: number | null; source: AnswerSource } {
  const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n < row.row.options.length
  const pick = resolutions[row.row.id]
  if (pick !== undefined && inRange(pick)) return { index: pick, source: 'human' }
  const engine = Number(row.row.correct_index)
  if (row.row.correct_index !== '' && inRange(engine)) return { index: engine, source: 'extracted' }
  const ai = aiAnswers?.[row.row.id]
  if (ai !== undefined && ai.index !== null && inRange(ai.index)) return { index: ai.index, source: 'ai' }
  return { index: null, source: 'none' }
}

export async function saveResolution(
  runId: string,
  rowId: string,
  optionIndex: number,
): Promise<void> {
  const artifact = await getArtifact(runId, 'review-resolutions')
  if (artifact === undefined) {
    await putArtifact({
      runId,
      kind: 'review-resolutions',
      json: { [rowId]: optionIndex },
    })
    return
  }
  const current = (artifact.json as Record<string, number> | undefined) ?? {}
  await db.runArtifacts.update(artifact.id, {
    json: { ...current, [rowId]: optionIndex },
  })
}

/**
 * What a bulk "switch to AI answers" would do, row by row — pure, so the
 * confirm dialog can state exactly what the user is approving before a
 * single resolution is written. Only confident AI answers (`certain` /
 * `likely` with a valid option index) are eligible; `unsure` ones are
 * counted but never applied in bulk — those stay for one-by-one review.
 */
export interface AiApplyPlan {
  /** rowId → the AI option index a confirm would save as a resolution. */
  picks: Record<string, number>
  /** Rows with no current answer the AI would fill. */
  fillCount: number
  /** Rows whose current answer the AI would replace. */
  differCount: number
  /** Rows where the AI agrees with the current answer — left untouched. */
  agreeCount: number
  /** Rows the AI answered without confidence — left untouched. */
  unsureCount: number
}

export function aiApplyPlan(
  rows: readonly ReviewRow[],
  resolutions: Resolutions,
  aiAnswers: Readonly<Record<string, AiAnswer>>,
): AiApplyPlan {
  const plan: AiApplyPlan = {
    picks: {},
    fillCount: 0,
    differCount: 0,
    agreeCount: 0,
    unsureCount: 0,
  }
  for (const reviewRow of rows) {
    const ai = aiAnswers[reviewRow.row.id]
    if (ai === undefined) continue
    const valid =
      ai.index !== null &&
      Number.isInteger(ai.index) &&
      ai.index >= 0 &&
      ai.index < reviewRow.row.options.length
    if (!valid || ai.confidence === 'unsure') {
      plan.unsureCount += 1
      continue
    }
    const current = effectiveAnswer(reviewRow, resolutions)
    if (current === ai.index) {
      plan.agreeCount += 1
    } else if (current === null) {
      plan.fillCount += 1
      plan.picks[reviewRow.row.id] = ai.index as number
    } else {
      plan.differCount += 1
      plan.picks[reviewRow.row.id] = ai.index as number
    }
  }
  return plan
}

/**
 * Saves many confirmed answers at once — the bulk "switch to AI" apply.
 * Callers must only pass picks the user explicitly approved; each pick is
 * an ordinary resolution, indistinguishable from a hand-confirmed one.
 */
export async function saveResolutions(
  runId: string,
  picks: Readonly<Record<string, number>>,
): Promise<void> {
  if (Object.keys(picks).length === 0) return
  const artifact = await getArtifact(runId, 'review-resolutions')
  if (artifact === undefined) {
    await putArtifact({ runId, kind: 'review-resolutions', json: { ...picks } })
    return
  }
  const current = (artifact.json as Record<string, number> | undefined) ?? {}
  await db.runArtifacts.update(artifact.id, {
    json: { ...current, ...picks },
  })
}

/** Removes one row's confirmed answer (edit mode deleted its option). */
export async function clearResolution(
  runId: string,
  rowId: string,
): Promise<void> {
  const artifact = await getArtifact(runId, 'review-resolutions')
  if (artifact === undefined) return
  const current = (artifact.json as Record<string, number> | undefined) ?? {}
  if (!(rowId in current)) return
  const next = { ...current }
  delete next[rowId]
  await db.runArtifacts.update(artifact.id, { json: next })
}

/**
 * The exported rows: engine output plus the tutor's confirmed answers.
 * Deterministic code owns this — a resolution must be a valid 0-based
 * index into that row's options or it is ignored and the flag stays.
 */
export function applyResolutions(
  rows: readonly MergedRow[],
  resolutions: Resolutions,
): MergedRow[] {
  return rows.map((row) => {
    const pick = resolutions[row.id]
    if (
      pick === undefined ||
      !Number.isInteger(pick) ||
      pick < 0 ||
      pick >= row.options.length
    ) {
      return row
    }
    return { ...row, correct_index: String(pick), needs_review: '' }
  })
}

/** Flags the tutor has not confirmed yet. */
export function unresolvedCount(
  rows: readonly MergedRow[],
  resolutions: Resolutions,
): number {
  return applyResolutions(rows, resolutions).filter(isFlagged).length
}

/**
 * Live per-run count of flags still waiting on the tutor — what the done
 * stage's heading, Review button, and export note all key off.
 */
export function useUnresolvedCounts(
  runIds: readonly string[],
): Record<string, number> | undefined {
  return useLiveQuery(async () => {
    const counts: Record<string, number> = {}
    for (const runId of runIds) {
      const merged = await getArtifact(runId, 'merged-rows')
      const rows = (merged?.json as MergedRow[] | undefined) ?? []
      // Edit-mode content edits first — an edit can blank an orphaned
      // answer (re-flagging the row), and resolutions validate against
      // the edited options, exactly as export applies them.
      const edited = applyContentEdits(rows, await getEdits(runId))
      counts[runId] = unresolvedCount(edited, await getResolutions(runId))
    }
    return counts
  }, [runIds.join('|')])
}
