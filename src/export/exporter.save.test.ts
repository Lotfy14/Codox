import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileSave } from 'browser-fs-access'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import { createRun, getRun, putArtifact, updateRun } from '../state/runs'
import { exportRuns } from './exporter'

/**
 * The Save-As hand-off, with `browser-fs-access` mocked: a picked location
 * reads as `saved`, the legacy anchor fallback as `downloaded`, a dismissed
 * dialog as `cancelled` — and only the first two stamp `exportedAt`
 * (export-early law). The unmocked download path lives in exporter.test.ts.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

vi.mock('browser-fs-access', () => ({
  fileSave: vi.fn(),
}))

const fileSaveMock = vi.mocked(fileSave)

beforeEach(async () => {
  fileSaveMock.mockReset()
  await db.runs.clear()
  await db.runArtifacts.clear()
  await db.meta.clear()
})

async function seedDoneRun(): Promise<string> {
  const rows: MergedRow[] = [
    {
      id: '1',
      group_id: '',
      topic: 'Surgery',
      subtopic: '',
      year: '',
      question: 'Question 1?',
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correct_index: '2',
      image_urls: [],
      needs_review: '',
    },
  ]
  const runId = await createRun({
    jobId: 'current',
    pdfId: 'pdf1',
    fileName: 'Exam.pdf',
  })
  await updateRun(runId, { status: 'done' })
  await putArtifact({ runId, kind: 'merged-rows', json: rows })
  return runId
}

describe('save-as hand-off outcomes', () => {
  it('a picked location is saved and stamps exportedAt', async () => {
    fileSaveMock.mockResolvedValue({} as FileSystemFileHandle)
    const runId = await seedDoneRun()

    const outcome = await exportRuns([(await getRun(runId))!])

    expect(outcome).toBe('saved')
    expect(fileSaveMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ fileName: 'Exam Cx.zip', extensions: ['.zip'] }),
    )
    expect((await getRun(runId))?.exportedAt).toBeDefined()
  })

  it('the legacy fallback is downloaded and still stamps exportedAt', async () => {
    fileSaveMock.mockResolvedValue(null)
    const runId = await seedDoneRun()

    expect(await exportRuns([(await getRun(runId))!])).toBe('downloaded')
    expect((await getRun(runId))?.exportedAt).toBeDefined()
  })

  it('a dismissed dialog is cancelled and never stamps exportedAt', async () => {
    fileSaveMock.mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    const runId = await seedDoneRun()

    expect(await exportRuns([(await getRun(runId))!])).toBe('cancelled')
    expect((await getRun(runId))?.exportedAt).toBeUndefined()
  })

  it('a non-cancel save failure surfaces as an error', async () => {
    fileSaveMock.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const runId = await seedDoneRun()

    await expect(exportRuns([(await getRun(runId))!])).rejects.toThrow()
    expect((await getRun(runId))?.exportedAt).toBeUndefined()
  })
})
