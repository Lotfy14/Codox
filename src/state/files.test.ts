import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  addStoredPdf,
  clearJobPdfs,
  putAnswerKeyPdf,
  removeStoredPdf,
} from './files'

const JOB = 'current'

function pdfEntry(name: string) {
  return {
    jobId: JOB,
    kind: 'exam' as const,
    name,
    size: 1234,
    pageCount: 3,
    blob: new Blob(['%PDF-fake'], { type: 'application/pdf' }),
  }
}

beforeEach(async () => {
  await db.files.clear()
})

describe('stored PDFs', () => {
  it('adds and lists exam PDFs for a job', async () => {
    await addStoredPdf(pdfEntry('a.pdf'))
    await addStoredPdf(pdfEntry('b.pdf'))
    const files = await db.files.where('jobId').equals(JOB).toArray()
    expect(files.map((file) => file.name).sort()).toEqual(['a.pdf', 'b.pdf'])
  })

  it('removes a single PDF', async () => {
    const id = await addStoredPdf(pdfEntry('a.pdf'))
    await addStoredPdf(pdfEntry('b.pdf'))
    await removeStoredPdf(id)
    const files = await db.files.toArray()
    expect(files.map((file) => file.name)).toEqual(['b.pdf'])
  })

  it('clears every PDF of a job', async () => {
    await addStoredPdf(pdfEntry('a.pdf'))
    await addStoredPdf(pdfEntry('b.pdf'))
    await clearJobPdfs(JOB)
    expect(await db.files.count()).toBe(0)
  })

  it('keeps at most one answer key per job — adding replaces', async () => {
    await addStoredPdf(pdfEntry('exam.pdf'))
    const { kind: _first, ...keyA } = pdfEntry('key_a.pdf')
    const { kind: _second, ...keyB } = pdfEntry('key_b.pdf')
    await putAnswerKeyPdf(keyA)
    await putAnswerKeyPdf(keyB)

    const files = await db.files.where('jobId').equals(JOB).toArray()
    const keys = files.filter((file) => file.kind === 'answer-key')
    expect(keys).toHaveLength(1)
    expect(keys[0].name).toBe('key_b.pdf')
    // The exam file is untouched by key replacement.
    expect(files.some((file) => file.name === 'exam.pdf')).toBe(true)
  })
})
