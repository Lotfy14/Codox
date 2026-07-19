/**
 * DIAGNOSTIC (2026-07-19) — per-stage wall-clock accumulation for the render
 * pipeline, so the Android-vs-browser gap can be read off a real device
 * instead of reasoned about. Nothing leaves the phone: the totals go into the
 * run record and are shown in the progress panel.
 *
 * Remove this file and its call sites once the slow stage is identified.
 */

/** The stages a page passes through, in pipeline order. */
export const STAGES = ['text', 'init', 'render', 'encode', 'store'] as const

export type Stage = (typeof STAGES)[number]

/** Cumulative milliseconds per stage across a whole document. */
export type StageTotals = Record<Stage, number>

export interface StageTimer {
  /** Run `fn`, adding its wall-clock duration to `stage`. */
  time<T>(stage: Stage, fn: () => Promise<T>): Promise<T>
  /** A snapshot of the totals so far, safe to persist. */
  totals(): StageTotals
}

function emptyTotals(): StageTotals {
  return { text: 0, init: 0, render: 0, encode: 0, store: 0 }
}

export function createStageTimer(): StageTimer {
  const totals = emptyTotals()
  return {
    async time(stage, fn) {
      const startedAt = performance.now()
      try {
        return await fn()
      } finally {
        // Recorded even when `fn` throws — a slow failure is still slow.
        totals[stage] += performance.now() - startedAt
      }
    },
    totals: () => ({ ...totals }),
  }
}

/** "render 84.2s · encode 11.0s · …" — longest stage first. */
export function formatStageTotals(totals: Partial<StageTotals>): string {
  return STAGES.filter((stage) => (totals[stage] ?? 0) > 0)
    .sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0))
    .map((stage) => `${stage} ${((totals[stage] ?? 0) / 1000).toFixed(1)}s`)
    .join(' · ')
}
