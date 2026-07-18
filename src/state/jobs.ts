import { db } from './db'
import { isBatchRunning } from '../engine/progress'
import type { JobState } from './types'

export const CURRENT_JOB_ID = 'current'

function freshCurrentJob(): JobState {
  return {
    id: CURRENT_JOB_ID,
    createdAt: Date.now(),
    step: 'setup',
    keepOriginal: false,
  }
}

export async function ensureCurrentJob(): Promise<void> {
  if ((await db.jobs.get(CURRENT_JOB_ID)) !== undefined) return
  try {
    await db.jobs.add(freshCurrentJob())
  } catch (error) {
    if ((await db.jobs.get(CURRENT_JOB_ID)) !== undefined) return
    throw error
  }
}

/**
 * Finish the current workspace and open a clean one.
 *
 * Runs move to a dated history job so their status and export artifacts stay
 * available. Original PDFs move with them only when the user explicitly chose
 * "Keep original PDF"; otherwise the source files are deleted during the same
 * transaction. A workspace with no runs has nothing to archive and is simply
 * cleared.
 */
export async function archiveCurrentJobAndReset(): Promise<string | null> {
  return db.transaction('rw', db.jobs, db.files, db.runs, async () => {
    const current = await db.jobs.get(CURRENT_JOB_ID)
    const runs = await db.runs.where('jobId').equals(CURRENT_JOB_ID).toArray()
    const files = await db.files.where('jobId').equals(CURRENT_JOB_ID).toArray()

    if (runs.length === 0) {
      await db.files.bulkDelete(files.map((file) => file.id))
      await db.jobs.put(freshCurrentJob())
      return null
    }

    const archivedId = `history-${Date.now()}-${crypto.randomUUID()}`
    await db.jobs.add({
      ...(current ?? freshCurrentJob()),
      id: archivedId,
      step: 'export',
    })
    await db.runs.bulkPut(
      runs.map((run) => ({ ...run, jobId: archivedId })),
    )

    if (current?.keepOriginal === true) {
      await db.files.bulkPut(
        files.map((file) => ({ ...file, jobId: archivedId })),
      )
    } else {
      await db.files.bulkDelete(files.map((file) => file.id))
    }

    await db.jobs.put(freshCurrentJob())
    return archivedId
  })
}

let startupArchive: Promise<void> | undefined

/**
 * Startup housekeeping (owner-approved 2026-07-18): a reload should open a
 * clean Convert workspace, not the finished conversion's done screen. If the
 * current workspace holds a batch that is over (every run done or stopped),
 * retire it into History exactly like "Convert another" and open a fresh one.
 *
 * A batch still running or paused is left completely untouched — the resume
 * path in useConversion (`findResumableRuns`) owns it, and a mid-run reload
 * must pick up where it left off rather than lose progress. `isBatchRunning`
 * is true for exactly the runs the resumer claims, so the two never touch the
 * same batch. The promise is memoized so React StrictMode's double-invoked
 * startup effect can't archive the same finished batch twice.
 */
export function archiveFinishedCurrentJobOnStartup(): Promise<void> {
  startupArchive ??= (async () => {
    const runs = await db.runs.where('jobId').equals(CURRENT_JOB_ID).toArray()
    if (runs.length === 0 || isBatchRunning(runs)) return
    await archiveCurrentJobAndReset()
  })()
  return startupArchive
}

/** Test-only: forget the memoized startup archive so a fresh load can re-run it. */
export function resetStartupArchiveForTests(): void {
  startupArchive = undefined
}

/** Clears an unstarted draft and resets its options without creating history. */
export async function clearCurrentDraft(): Promise<void> {
  await db.transaction('rw', db.jobs, db.files, async () => {
    await db.files.where('jobId').equals(CURRENT_JOB_ID).delete()
    await db.jobs.put(freshCurrentJob())
  })
}
