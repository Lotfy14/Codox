import { db } from './db'
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

/** Clears an unstarted draft and resets its options without creating history. */
export async function clearCurrentDraft(): Promise<void> {
  await db.transaction('rw', db.jobs, db.files, async () => {
    await db.files.where('jobId').equals(CURRENT_JOB_ID).delete()
    await db.jobs.put(freshCurrentJob())
  })
}
