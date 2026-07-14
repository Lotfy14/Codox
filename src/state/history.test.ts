import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addStoredPdf } from './files'
import { deleteHistoryRun, restoreHistoryRun } from './history'
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

describe('history restore', () => {
  async function addArchivedRun(withOriginal = true): Promise<string> {
    await db.jobs.add({
      id: HISTORY_JOB,
      createdAt: 1,
      step: 'export',
      keepOriginal: withOriginal,
    })
    const pdfId = withOriginal
      ? await addStoredPdf({
          jobId: HISTORY_JOB,
          kind: 'exam',
          name: 'old exam.pdf',
          size: 100,
          pageCount: 2,
          blob: new Blob(['exam'], { type: 'application/pdf' }),
        })
      : 'removed-pdf'
    if (withOriginal) {
      await addStoredPdf({
        jobId: HISTORY_JOB,
        kind: 'answer-key',
        name: 'answers.pdf',
        size: 20,
        pageCount: 1,
        blob: new Blob(['key'], { type: 'application/pdf' }),
      })
    }
    return createRun({
      jobId: HISTORY_JOB,
      pdfId,
      fileName: 'old exam.pdf',
      pageCount: 2,
    })
  }

  it('copies the retained exam and answer key into a clean current workspace', async () => {
    const runId = await addArchivedRun()

    expect(await restoreHistoryRun(runId)).toBe('restored')

    const currentFiles = await db.files
      .where('jobId')
      .equals('current')
      .sortBy('addedAt')
    expect(currentFiles.map((file) => [file.kind, file.name])).toEqual([
      ['exam', 'old exam.pdf'],
      ['answer-key', 'answers.pdf'],
    ])
    expect(await db.runs.get(runId)).toMatchObject({ jobId: HISTORY_JOB })
  })

  it('does not pretend a removed original can be restored', async () => {
    const runId = await addArchivedRun(false)

    expect(await restoreHistoryRun(runId)).toBe('missing-original')
    expect(await db.files.where('jobId').equals('current').count()).toBe(0)
  })

  it('never overwrites an occupied current workspace', async () => {
    const runId = await addArchivedRun()
    await db.jobs.put({ id: 'current', createdAt: 2, step: 'setup' })
    await addStoredPdf({
      jobId: 'current',
      kind: 'exam',
      name: 'current.pdf',
      size: 10,
      pageCount: 1,
      blob: new Blob(['current'], { type: 'application/pdf' }),
    })

    expect(await restoreHistoryRun(runId)).toBe('current-not-empty')
    const names = await db.files.where('jobId').equals('current').sortBy('addedAt')
    expect(names.map((file) => file.name)).toEqual(['current.pdf'])
  })
})
