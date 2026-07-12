import { describe, expect, it } from 'vitest'
import { batchProgress, isBatchRunning, runProgress, totalFlags } from './progress'
import type { RunState } from '../state/types'

function makeRun(overrides: Partial<RunState> = {}): RunState {
  return {
    id: 'run1',
    jobId: 'job1',
    pdfId: 'pdf1',
    fileName: 'exam.pdf',
    status: 'running',
    step: 'render',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('runProgress', () => {
  it('is 0 at the start of the render step', () => {
    expect(runProgress(makeRun({ pageCount: 10, pagesRendered: 0 }))).toBe(0)
  })

  it('advances within the render step as pages land', () => {
    const half = runProgress(makeRun({ pageCount: 10, pagesRendered: 5 }))
    const all = runProgress(makeRun({ pageCount: 10, pagesRendered: 10 }))
    expect(half).toBeGreaterThan(0)
    expect(all).toBeGreaterThan(half)
    expect(all).toBeLessThan(1) // rendering is not the whole job
  })

  it('advances within the worker step as chunks land', () => {
    const one = runProgress(makeRun({ step: 'worker', chunkCount: 3, chunksDone: 1 }))
    const two = runProgress(makeRun({ step: 'worker', chunkCount: 3, chunksDone: 2 }))
    expect(two).toBeGreaterThan(one)
  })

  it('never goes backwards across steps', () => {
    const steps: RunState['step'][] = [
      'render',
      'planner',
      'blueprint',
      'crops',
      'worker',
      'merge',
      'emit',
      'audit',
    ]
    const values = steps.map((step) =>
      runProgress(makeRun({ step, pageCount: 4, pagesRendered: 4, chunkCount: 2, chunksDone: 2 })),
    )
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it('is exactly 1 for a finished run', () => {
    expect(runProgress(makeRun({ status: 'done', step: 'audit' }))).toBe(1)
  })

  it('a paused run keeps its progress (a pause is not a reset)', () => {
    const running = runProgress(
      makeRun({ status: 'running', step: 'worker', chunkCount: 4, chunksDone: 2 }),
    )
    const paused = runProgress(
      makeRun({ status: 'paused', step: 'worker', chunkCount: 4, chunksDone: 2 }),
    )
    expect(paused).toBe(running)
  })
})

describe('batchProgress', () => {
  it('weights each run by its page count', () => {
    const big = makeRun({ id: 'a', pageCount: 25, status: 'done', step: 'audit' })
    const small = makeRun({ id: 'b', pageCount: 1, step: 'render', pagesRendered: 0 })
    // 25 of 26 pages' worth of work is finished → well past halfway.
    expect(batchProgress([big, small])).toBeGreaterThan(0.9)
  })

  it('is 0 with no runs and 1 when every run is done', () => {
    expect(batchProgress([])).toBe(0)
    expect(
      batchProgress([
        makeRun({ id: 'a', status: 'done', step: 'audit' }),
        makeRun({ id: 'b', status: 'done', step: 'audit' }),
      ]),
    ).toBe(1)
  })
})

describe('isBatchRunning and totalFlags', () => {
  it('a stopped run does not keep the batch running', () => {
    expect(
      isBatchRunning([makeRun({ status: 'stopped', stopReason: 'render_failed' })]),
    ).toBe(false)
  })

  it('a paused run keeps the batch running (it resumes by itself)', () => {
    expect(isBatchRunning([makeRun({ status: 'paused' })])).toBe(true)
  })

  it('sums flags across the batch', () => {
    expect(
      totalFlags([
        makeRun({ id: 'a', flaggedRows: 3 }),
        makeRun({ id: 'b', flaggedRows: 4 }),
        makeRun({ id: 'c' }),
      ]),
    ).toBe(7)
  })
})
