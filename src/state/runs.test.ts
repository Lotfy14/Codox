import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createRun, stopJobRuns } from './runs'
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
