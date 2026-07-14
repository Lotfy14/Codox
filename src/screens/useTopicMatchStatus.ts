/**
 * Live count of finished-run questions still waiting for a topic match —
 * the done stage's honesty line. Zero both when everything matched and
 * when no run has a topic list (nothing was ever pending).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import {
  pendingMatchRows,
  readRunTopics,
  readTopicMatches,
} from '../engine/topic-matcher'
import type { MergedRow } from '../engine/types'
import { getArtifact } from '../state/runs'
import type { RunState } from '../state/types'

export function useTopicMatchPending(
  runs: readonly RunState[],
): number | undefined {
  const doneIds = runs
    .filter((run) => run.status === 'done')
    .map((run) => run.id)
    .join(',')
  return useLiveQuery(
    async () => {
      let pending = 0
      for (const runId of doneIds === '' ? [] : doneIds.split(',')) {
        const topics = await readRunTopics(runId)
        if (topics === undefined) continue
        const merged = await getArtifact(runId, 'merged-rows')
        const rows = (merged?.json as MergedRow[] | undefined) ?? []
        pending += pendingMatchRows(rows, await readTopicMatches(runId)).length
      }
      return pending
    },
    [doneIds],
  )
}
