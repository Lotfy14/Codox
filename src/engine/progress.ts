/**
 * Run progress (pure): persisted run state → a 0–1 fraction the Progress
 * bars render. Derived from the checkpoint itself, so a reload mid-run
 * redraws exactly the same bar rather than restarting at zero.
 *
 * The weights are honest about where the time goes: rendering and the
 * worker chunks dominate a real exam; the planner is one big call; merge,
 * emit, and the audit are quick.
 */
import type { RunState } from '../state/types'
import { RUN_STEPS, type RunStep } from './types'

const STEP_WEIGHTS: Record<RunStep, number> = {
  render: 0.2,
  planner: 0.2,
  blueprint: 0.02,
  crops: 0.03,
  worker: 0.4,
  merge: 0.02,
  emit: 0.03,
  audit: 0.1,
}

const TOTAL_WEIGHT = Object.values(STEP_WEIGHTS).reduce((a, b) => a + b, 0)

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** How far through its own step the run is (0–1), where we can tell. */
function stepFraction(run: RunState): number {
  if (run.step === 'render') {
    if (run.pageCount === undefined || run.pageCount === 0) return 0
    return clamp01((run.pagesRendered ?? 0) / run.pageCount)
  }
  if (run.step === 'worker') {
    if (run.chunkCount === undefined || run.chunkCount === 0) return 0
    return clamp01((run.chunksDone ?? 0) / run.chunkCount)
  }
  return 0
}

/** One run's overall progress, 0–1. A finished run is always exactly 1. */
export function runProgress(run: RunState): number {
  if (run.status === 'done') return 1
  const currentIndex = RUN_STEPS.indexOf(run.step as RunStep)
  if (currentIndex < 0) return 0

  let done = 0
  for (let i = 0; i < currentIndex; i += 1) {
    done += STEP_WEIGHTS[RUN_STEPS[i]]
  }
  done += STEP_WEIGHTS[RUN_STEPS[currentIndex]] * stepFraction(run)
  return clamp01(done / TOTAL_WEIGHT)
}

/**
 * Batch progress across the job's runs, 0–1, weighted by page count so a
 * 25-page PDF does not advance the bar as fast as a 2-page one.
 */
export function batchProgress(runs: readonly RunState[]): number {
  if (runs.length === 0) return 0
  const weights = runs.map((run) => Math.max(1, run.pageCount ?? 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const done = runs.reduce(
    (sum, run, index) => sum + runProgress(run) * weights[index],
    0,
  )
  return clamp01(done / total)
}

/** True while any run still has work to do. */
export function isBatchRunning(runs: readonly RunState[]): boolean {
  return runs.some((run) => run.status === 'running' || run.status === 'paused')
}

/** Every flag the batch produced — the number the Done stage announces. */
export function totalFlags(runs: readonly RunState[]): number {
  return runs.reduce((sum, run) => sum + (run.flaggedRows ?? 0), 0)
}
