import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { AnswerSource, StoredPdf } from './types'

type NewStoredPdf = Omit<StoredPdf, 'id' | 'addedAt'>

/** Store one exam PDF for a job. */
export async function addStoredPdf(entry: NewStoredPdf): Promise<string> {
  const id = crypto.randomUUID()
  await db.files.add({ ...entry, id, addedAt: Date.now() })
  return id
}

/**
 * Store the job's answer-key PDF. A job has at most one answer key —
 * adding a new one replaces the old, transactionally.
 */
export async function putAnswerKeyPdf(
  entry: Omit<NewStoredPdf, 'kind'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await db.transaction('rw', db.files, async () => {
    const existing = await db.files.where('jobId').equals(entry.jobId).toArray()
    await db.files.bulkDelete(
      existing.filter((file) => file.kind === 'answer-key').map((file) => file.id),
    )
    await db.files.add({ ...entry, kind: 'answer-key', id, addedAt: Date.now() })
  })
  return id
}

export async function removeStoredPdf(id: string): Promise<void> {
  await db.files.delete(id)
}

export async function clearJobPdfs(jobId: string): Promise<void> {
  await db.files.where('jobId').equals(jobId).delete()
}

/** Set or clear (undefined = batch default) a per-file declaration override. */
export async function setPdfAnswerSource(
  id: string,
  answerSource: AnswerSource | undefined,
): Promise<void> {
  await db.files.update(id, { answerSource })
}

/** Live view of a job's stored PDFs, oldest first. undefined while loading. */
export function useJobPdfs(jobId: string): StoredPdf[] | undefined {
  return useLiveQuery(
    () => db.files.where('jobId').equals(jobId).sortBy('addedAt'),
    [jobId],
  )
}
