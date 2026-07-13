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
    const [runs, files] = await Promise.all([
      db.runs.toArray(),
      db.files.toArray(),
    ])
    const fileIds = new Set(files.map((file) => file.id))
    return runs
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
