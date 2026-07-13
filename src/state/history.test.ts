import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addStoredPdf } from './files'
import { deleteHistoryRun } from './history'
import { createRun, putArtifact } from './runs'

const HISTORY_JOB = 'history-test'

beforeEach(async () => {
  await Promise.all([
    db.runArtifacts.clear(),
    db.runs.clear(),
    db.files.clear(),
    db.jobs.clear(),
  ])
})

describe('history deletion', () => {
  it('deletes an archived run, artifacts, retained PDF, and empty job', async () => {
    await db.jobs.add({
      id: HISTORY_JOB,
      createdAt: 1,
      step: 'export',
      keepOriginal: true,
    })
    const pdfId = await addStoredPdf({
      jobId: HISTORY_JOB,
      kind: 'exam',
      name: 'old.pdf',
      size: 100,
      pageCount: 1,
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    })
    const runId = await createRun({
      jobId: HISTORY_JOB,
      pdfId,
      fileName: 'old.pdf',
      pageCount: 1,
    })
    await putArtifact({ runId, kind: 'csv', text: 'csv' })

    await deleteHistoryRun(runId)

    expect(await db.runs.get(runId)).toBeUndefined()
    expect(await db.runArtifacts.where('runId').equals(runId).count()).toBe(0)
    expect(await db.files.get(pdfId)).toBeUndefined()
    expect(await db.jobs.get(HISTORY_JOB)).toBeUndefined()
  })

  it('refuses to delete a run that still belongs to the current workspace', async () => {
    const runId = await createRun({
      jobId: 'current',
      pdfId: 'pdf-current',
      fileName: 'current.pdf',
      pageCount: 1,
    })

    await deleteHistoryRun(runId)

    expect(await db.runs.get(runId)).toBeDefined()
  })
})
