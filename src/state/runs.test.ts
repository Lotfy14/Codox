import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { clearArtifacts, createRun, getArtifacts, putArtifact, stopJobRuns } from './runs'
import type { RunState } from './types'

const JOB = 'current'

async function addRun(status: RunState['status']): Promise<string> {
  const id = await createRun({
    jobId: JOB,
    pdfId: 'pdf-1',
    fileName: 'exam.pdf',
    pageCount: 3,
  })
  await db.runs.update(id, { status })
  return id
}

beforeEach(async () => {
  await db.runs.clear()
  await db.runArtifacts.clear()
})

describe('stopJobRuns', () => {
  it('stops running and paused runs but leaves finished ones alone', async () => {
    const runningId = await addRun('running')
    const pausedId = await addRun('paused')
    const doneId = await addRun('done')
    const stoppedId = await addRun('stopped')

    await stopJobRuns(JOB)

    expect((await db.runs.get(runningId))?.status).toBe('stopped')
    expect((await db.runs.get(runningId))?.stopReason).toBe('cancelled')
    expect((await db.runs.get(pausedId))?.status).toBe('stopped')
    expect((await db.runs.get(doneId))?.status).toBe('done')
    expect((await db.runs.get(stoppedId))?.stopReason).toBeUndefined()
  })
})

describe('clearArtifacts', () => {
  it('with a chunkIndex drops only that chunk, keeping other chunks resumable', async () => {
    const runId = 'run-1'
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: 0, text: 'chunk 0' })
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: 1, text: 'chunk 1 attempt 1' })
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: 1, text: 'chunk 1 attempt 2' })
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: 2, text: 'chunk 2' })

    await clearArtifacts(runId, 'chunk-response', 1)

    const remaining = await getArtifacts(runId, 'chunk-response')
    expect(remaining.map((artifact) => artifact.chunkIndex)).toEqual([0, 2])
  })

  it('without a chunkIndex still drops the whole kind', async () => {
    const runId = 'run-1'
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: 0, text: 'chunk 0' })
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: 1, text: 'chunk 1' })

    await clearArtifacts(runId, 'chunk-response')

    expect(await getArtifacts(runId, 'chunk-response')).toEqual([])
  })
})
