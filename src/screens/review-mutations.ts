/**
 * Review add/delete layer. Like resolutions and edits, these are the tutor's
 * own explicit changes stored in their own artifacts — the engine's
 * `merged-rows` stays read-only history and both are applied deterministically
 * at export.
 *
 *  - `review-deletions` (a rowId list) hides rows from review and the CSV. It
 *    is REVERSIBLE: nothing is destroyed, so a deleted row (and its edits and
 *    resolution) comes back intact when the id is removed from the list.
 *  - `review-additions` (a MergedRow list) holds tutor-authored questions
 *    appended after the engine's rows. An added row is a plain blank row the
 *    tutor fills in through the ordinary editor; its content, answer, topic and
 *    year flow through `review-edits`/`review-resolutions` by id exactly like
 *    any engine row, so nothing special-cases it downstream.
 *
 * NEVER-GUESS is untouched: an added row's answer is only ever the tutor's own
 * explicit pick; a blank added row stays flagged until they fill it.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'

// -------------------------------------------------------------- deletions

export async function getDeletions(runId: string): Promise<string[]> {
  const artifact = await getArtifact(runId, 'review-deletions')
  const json = artifact?.json as string[] | undefined
  return Array.isArray(json) ? json : []
}

/** Live view of a run's deleted rowIds. undefined while loading. */
export function useDeletions(runId: string): string[] | undefined {
  return useLiveQuery(() => getDeletions(runId), [runId])
}

/** Adds or removes rows from the deletion set (the Undo path passes false). */
export async function setRowsDeleted(
  runId: string,
  rowIds: readonly string[],
  deleted: boolean,
): Promise<void> {
  if (rowIds.length === 0) return
  const artifact = await getArtifact(runId, 'review-deletions')
  const current = new Set((artifact?.json as string[] | undefined) ?? [])
  for (const id of rowIds) {
    if (deleted) current.add(id)
    else current.delete(id)
  }
  const next = [...current]
  if (artifact === undefined) {
    await putArtifact({ runId, kind: 'review-deletions', json: next })
    return
  }
  await db.runArtifacts.update(artifact.id, { json: next })
}

/** Drops the deleted rows — the one place the deletion set is consumed. */
export function applyDeletions(
  rows: readonly MergedRow[],
  deleted: ReadonlySet<string>,
): MergedRow[] {
  return rows.filter((row) => !deleted.has(row.id))
}

// -------------------------------------------------------------- additions

/** Engine ids are printed numbers or `group`-scoped; this prefix cannot
 *  collide with them, so an added row is always recognisable and its id is
 *  unique across the run. */
const ADDED_PREFIX = 'added-'

export function isAddedRowId(rowId: string): boolean {
  return rowId.startsWith(ADDED_PREFIX)
}

/** A fresh, empty MCQ the tutor will fill in. Blank answer → it ships flagged
 *  (and shows in "needs review") until the tutor gives it one. */
export function blankAddedRow(id: string): MergedRow {
  return {
    id,
    group_id: '',
    topic: '',
    subtopic: '',
    year: '',
    question: '',
    options: ['', ''],
    correct_index: '',
    image_urls: [],
    needs_review: 'added_row',
  }
}

export async function getAdditions(runId: string): Promise<MergedRow[]> {
  const artifact = await getArtifact(runId, 'review-additions')
  const json = artifact?.json as MergedRow[] | undefined
  return Array.isArray(json) ? json : []
}

/** Live view of a run's tutor-added rows. undefined while loading. */
export function useAdditions(runId: string): MergedRow[] | undefined {
  return useLiveQuery(() => getAdditions(runId), [runId])
}

/** Appends one blank row and returns its id (the caller opens it to edit). */
export async function addRow(runId: string): Promise<string> {
  const id = `${ADDED_PREFIX}${crypto.randomUUID()}`
  const artifact = await getArtifact(runId, 'review-additions')
  const current = (artifact?.json as MergedRow[] | undefined) ?? []
  const next = [...current, blankAddedRow(id)]
  if (artifact === undefined) {
    await putArtifact({ runId, kind: 'review-additions', json: next })
    return id
  }
  await db.runArtifacts.update(artifact.id, { json: next })
  return id
}
