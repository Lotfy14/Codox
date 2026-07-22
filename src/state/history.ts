import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { CURRENT_JOB_ID } from './jobs'
import type { RunState } from './types'

export interface HistoryRun {
  isCurrent: boolean
  originalKept: boolean
  run: RunState
}

export function useHistoryRuns(): HistoryRun[] | undefined {
  return useLiveQuery(async () => {
    const [runs, files, folders] = await Promise.all([
      db.runs.toArray(),
      db.files.toArray(),
      db.jobs.where('kind').equals('folder').primaryKeys(),
    ])
    const fileIds = new Set(files.map((file) => file.id))
    // Folder runs live in the Folders tab, not History (owner-approved
    // 2026-07-22) — otherwise a folder's conversions would double-appear.
    const folderJobIds = new Set(folders)
    return runs
      .filter((run) => !folderJobIds.has(run.jobId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((run) => ({
        run,
        isCurrent: run.jobId === CURRENT_JOB_ID,
        originalKept: fileIds.has(run.pdfId),
      }))
  }, [])
}

/** Deletes one archived run and its artifacts; current work is never touched. */
export async function deleteHistoryRun(runId: string): Promise<void> {
  await db.transaction(
    'rw',
    db.jobs,
    db.files,
    db.runs,
    db.runArtifacts,
    async () => {
      const run = await db.runs.get(runId)
      if (run === undefined || run.jobId === CURRENT_JOB_ID) return

      const artifacts = await db.runArtifacts
        .where('runId')
        .equals(run.id)
        .toArray()
      await db.runArtifacts.bulkDelete(artifacts.map((item) => item.id))
      await db.runs.delete(run.id)

      const remaining = await db.runs
        .where('jobId')
        .equals(run.jobId)
        .toArray()
      if (!remaining.some((item) => item.pdfId === run.pdfId)) {
        await db.files.delete(run.pdfId)
      }
      if (remaining.length === 0) {
        await db.files.where('jobId').equals(run.jobId).delete()
        await db.jobs.delete(run.jobId)
      }
    },
  )
}

export type RestoreHistoryResult =
  | 'restored'
  | 'missing-original'
  | 'current-not-empty'

/**
 * Copies one retained historical exam (and its job's answer key, when any)
 * into the empty current workspace. History itself is never mutated, so the
 * old result and its export remain available after the new conversion starts.
 */
export async function restoreHistoryRun(
  runId: string,
): Promise<RestoreHistoryResult> {
  return db.transaction('rw', db.jobs, db.files, db.runs, async () => {
    const run = await db.runs.get(runId)
    if (run === undefined || run.jobId === CURRENT_JOB_ID) {
      return 'missing-original'
    }

    const source = await db.files.get(run.pdfId)
    if (source === undefined) return 'missing-original'

    const [currentFiles, currentRuns] = await Promise.all([
      db.files.where('jobId').equals(CURRENT_JOB_ID).count(),
      db.runs.where('jobId').equals(CURRENT_JOB_ID).count(),
    ])
    if (currentFiles > 0 || currentRuns > 0) return 'current-not-empty'

    const archivedFiles = await db.files
      .where('jobId')
      .equals(run.jobId)
      .toArray()
    // Restore the archived answer key whenever one exists — a key present
    // is a key attached; the planner decides from evidence what it means.
    const answerKey = archivedFiles.find(
      (file) =>
        file.kind === 'answer-key' &&
        (run.answerKeyPdfId === undefined || file.id === run.answerKeyPdfId),
    )
    const now = Date.now()
    const examId = crypto.randomUUID()

    await db.jobs.put({
      id: CURRENT_JOB_ID,
      createdAt: now,
      step: 'setup',
      keepOriginal: false,
    })
    await db.files.add({
      ...source,
      id: examId,
      jobId: CURRENT_JOB_ID,
      addedAt: now,
    })
    if (answerKey !== undefined) {
      await db.files.add({
        ...answerKey,
        id: crypto.randomUUID(),
        jobId: CURRENT_JOB_ID,
        addedAt: now + 1,
      })
    }
    return 'restored'
  })
}
