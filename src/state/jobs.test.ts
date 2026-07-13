import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addStoredPdf } from './files'
import {
  archiveCurrentJobAndReset,
  clearCurrentDraft,
  CURRENT_JOB_ID,
  ensureCurrentJob,
} from './jobs'
import { createRun, putArtifact } from './runs'
import { db } from './db'

async function addPdf(name = 'exam.pdf'): Promise<string> {
  return addStoredPdf({
    jobId: CURRENT_JOB_ID,
    kind: 'exam',
    name,
    size: 100,
    pageCount: 2,
    blob: new Blob(['pdf'], { type: 'application/pdf' }),
  })
}

beforeEach(async () => {
  await Promise.all([
    db.runArtifacts.clear(),
    db.runs.clear(),
    db.files.clear(),
    db.jobs.clear(),
  ])
  await ensureCurrentJob()
})

describe('current workspace lifecycle', () => {
  it('archives run status, removes the default source PDF, and opens clean', async () => {
    const pdfId = await addPdf()
    const runId = await createRun({
      jobId: CURRENT_JOB_ID,
      pdfId,
      fileName: 'exam.pdf',
      pageCount: 2,
    })
    await db.runs.update(runId, { status: 'done' })
    await putArtifact({ runId, kind: 'csv', text: 'id,question' })

    const archivedId = await archiveCurrentJobAndReset()

    expect(archivedId).toMatch(/^history-/)
    expect((await db.runs.get(runId))?.jobId).toBe(archivedId)
    expect(await db.files.get(pdfId)).toBeUndefined()
    expect(await db.runArtifacts.where('runId').equals(runId).count()).toBe(1)
    expect(await db.runs.where('jobId').equals(CURRENT_JOB_ID).count()).toBe(0)
    expect((await db.jobs.get(CURRENT_JOB_ID))?.keepOriginal).toBe(false)
  })

  it('moves source PDFs into history only when Keep original is selected', async () => {
    await db.jobs.update(CURRENT_JOB_ID, { keepOriginal: true })
    const pdfId = await addPdf()
    await createRun({
      jobId: CURRENT_JOB_ID,
      pdfId,
      fileName: 'exam.pdf',
      pageCount: 2,
    })

    const archivedId = await archiveCurrentJobAndReset()

    expect((await db.files.get(pdfId))?.jobId).toBe(archivedId)
  })

  it('clears an unstarted draft without creating a history job', async () => {
    await addPdf()

    await clearCurrentDraft()

    expect(await db.files.count()).toBe(0)
    expect(await db.jobs.count()).toBe(1)
    expect(await db.jobs.get(CURRENT_JOB_ID)).toMatchObject({
      step: 'setup',
      keepOriginal: false,
    })
  })
})
