import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  addStoredPdf,
  clearJobPdfs,
  putAnswerKeyPdf,
  putTopicsDoc,
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

  it('keeps at most one answer key per exam — adding replaces that exam only', async () => {
    const examId = await addStoredPdf(pdfEntry('exam.pdf'))
    const { kind: _first, ...keyA } = pdfEntry('key_a.pdf')
    const { kind: _second, ...keyB } = pdfEntry('key_b.pdf')
    await putAnswerKeyPdf(keyA, examId)
    await putAnswerKeyPdf(keyB, examId)

    const files = await db.files.where('jobId').equals(JOB).toArray()
    const keys = files.filter((file) => file.kind === 'answer-key')
    expect(keys).toHaveLength(1)
    expect(keys[0].name).toBe('key_b.pdf')
    expect(keys[0].parentPdfId).toBe(examId)
    // The exam file is untouched by key replacement.
    expect(files.some((file) => file.name === 'exam.pdf')).toBe(true)
  })

  it('keeps a separate answer key per exam', async () => {
    const examA = await addStoredPdf(pdfEntry('exam_a.pdf'))
    const examB = await addStoredPdf(pdfEntry('exam_b.pdf'))
    const { kind: _a, ...keyA } = pdfEntry('key_a.pdf')
    const { kind: _b, ...keyB } = pdfEntry('key_b.pdf')
    await putAnswerKeyPdf(keyA, examA)
    await putAnswerKeyPdf(keyB, examB)

    const keys = (await db.files.where('jobId').equals(JOB).toArray()).filter(
      (file) => file.kind === 'answer-key',
    )
    expect(keys).toHaveLength(2)
    expect(keys.find((k) => k.parentPdfId === examA)?.name).toBe('key_a.pdf')
    expect(keys.find((k) => k.parentPdfId === examB)?.name).toBe('key_b.pdf')
  })

  it('removing an exam removes its linked answer key', async () => {
    const examId = await addStoredPdf(pdfEntry('exam.pdf'))
    const { kind: _k, ...key } = pdfEntry('key.pdf')
    await putAnswerKeyPdf(key, examId)
    await removeStoredPdf(examId)

    expect(await db.files.count()).toBe(0)
  })

  it('keeps at most one topics document per job — adding replaces', async () => {
    const examId = await addStoredPdf(pdfEntry('exam.pdf'))
    const { kind: _first, ...key } = pdfEntry('key.pdf')
    const { kind: _second, ...topicsA } = pdfEntry('topics_a.pdf')
    const { kind: _third, ...topicsB } = pdfEntry('topics_b.png')
    await putAnswerKeyPdf(key, examId)
    await putTopicsDoc(topicsA)
    await putTopicsDoc(topicsB)

    const files = await db.files.where('jobId').equals(JOB).toArray()
    const topics = files.filter((file) => file.kind === 'topics')
    expect(topics).toHaveLength(1)
    expect(topics[0].name).toBe('topics_b.png')
    // Replacing the topics doc never touches the answer key.
    expect(files.some((file) => file.kind === 'answer-key')).toBe(true)
  })
})
