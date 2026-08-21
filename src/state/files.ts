import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { ensureStoragePersisted } from './persist'
import type { StoredPdf } from './types'

type NewStoredPdf = Omit<StoredPdf, 'id' | 'addedAt'>

/** Store one exam PDF for a job. */
export async function addStoredPdf(entry: NewStoredPdf): Promise<string> {
  const id = crypto.randomUUID()
  // Adding a PDF is the first moment this device holds work worth keeping —
  // the right moment to ask the browser not to evict it. Memoized, so the
  // browser is asked once per session however many files are added, and a
  // refusal never blocks the write.
  void ensureStoragePersisted()
  await db.files.add({ ...entry, id, addedAt: Date.now() })
  return id
}

/**
 * Sets one exam's export source and keeps an existing run in sync. Updating
 * the run matters when the original PDF is later omitted from History.
 */
export async function setStoredPdfSource(
  pdfId: string,
  source: string,
): Promise<void> {
  const normalized = source.trim()
  await db.transaction('rw', db.files, db.runs, async () => {
    await db.files.update(pdfId, { source: normalized })
    const runs = await db.runs.where('pdfId').equals(pdfId).toArray()
    if (runs.length > 0) {
      await db.runs.bulkPut(
        runs.map((run) => ({
          ...run,
          source: normalized,
          updatedAt: Date.now(),
        })),
      )
    }
  })
}

/**
 * Store the answer-key PDF for one specific exam (`parentPdfId`). Each exam
 * carries at most one key — adding a new one replaces that exam's old key,
 * transactionally, and never touches another exam's key.
 */
export async function putAnswerKeyPdf(
  entry: Omit<NewStoredPdf, 'kind'>,
  parentPdfId: string,
): Promise<string> {
  const id = crypto.randomUUID()
  await db.transaction('rw', db.files, async () => {
    const existing = await db.files.where('jobId').equals(entry.jobId).toArray()
    await db.files.bulkDelete(
      existing
        .filter(
          (file) =>
            file.kind === 'answer-key' && file.parentPdfId === parentPdfId,
        )
        .map((file) => file.id),
    )
    await db.files.add({
      ...entry,
      kind: 'answer-key',
      parentPdfId,
      id,
      addedAt: Date.now(),
    })
  })
  return id
}

/** The answer key stored for a given exam PDF, if the tutor added one. */
export function answerKeyFor(
  files: readonly StoredPdf[],
  examId: string,
): StoredPdf | undefined {
  return files.find(
    (file) => file.kind === 'answer-key' && file.parentPdfId === examId,
  )
}

/**
 * Store the job's topics document (PDF or image). A job has at most one —
 * adding a new one replaces the old, transactionally.
 */
export async function putTopicsDoc(
  entry: Omit<NewStoredPdf, 'kind'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await db.transaction('rw', db.files, async () => {
    const existing = await db.files.where('jobId').equals(entry.jobId).toArray()
    await db.files.bulkDelete(
      existing.filter((file) => file.kind === 'topics').map((file) => file.id),
    )
    await db.files.add({ ...entry, kind: 'topics', id, addedAt: Date.now() })
  })
  return id
}

/**
 * Remove a stored file. Removing an exam also removes the answer key linked
 * to it (`parentPdfId`), so a key never outlives the exam it belonged to.
 */
export async function removeStoredPdf(id: string): Promise<void> {
  await db.transaction('rw', db.files, async () => {
    await db.files.delete(id)
    const orphans = await db.files
      .filter((file) => file.parentPdfId === id)
      .toArray()
    await db.files.bulkDelete(orphans.map((file) => file.id))
  })
}

export async function clearJobPdfs(jobId: string): Promise<void> {
  await db.files.where('jobId').equals(jobId).delete()
}

/** Live view of a job's stored PDFs, oldest first. undefined while loading. */
export function useJobPdfs(jobId: string): StoredPdf[] | undefined {
  return useLiveQuery(
    () => db.files.where('jobId').equals(jobId).sortBy('addedAt'),
    [jobId],
  )
}
