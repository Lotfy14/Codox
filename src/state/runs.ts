/**
 * Run + artifact persistence (Dexie v5). The executor writes every step's
 * inputs and outputs here before the next step starts (CODOX_MIGRATION
 * §1.3) — which is also exactly what resume needs: the artifacts present
 * ARE the checkpoint.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { RunArtifact, RunArtifactKind, RunState } from './types'

export async function createRun(
  entry: Omit<RunState, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'step'> &
    Partial<Pick<RunState, 'status' | 'step'>>,
): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.runs.add({
    status: 'running',
    step: 'render',
    ...entry,
    id,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function getRun(runId: string): Promise<RunState | undefined> {
  return db.runs.get(runId)
}

export async function updateRun(
  runId: string,
  changes: Partial<Omit<RunState, 'id'>>,
): Promise<void> {
  await db.runs.update(runId, { ...changes, updatedAt: Date.now() })
}

/** Adds one Gemini call to the run's quota-burn totals. */
export async function recordRequestUsage(
  runId: string,
  usage: {
    promptTokens?: number
    candidatesTokens?: number
    totalTokens?: number
  } = {},
): Promise<void> {
  await db.transaction('rw', db.runs, async () => {
    const run = await db.runs.get(runId)
    if (run === undefined) return
    await db.runs.update(runId, {
      requestCount: (run.requestCount ?? 0) + 1,
      promptTokens: (run.promptTokens ?? 0) + (usage.promptTokens ?? 0),
      candidatesTokens:
        (run.candidatesTokens ?? 0) + (usage.candidatesTokens ?? 0),
      totalTokens: (run.totalTokens ?? 0) + (usage.totalTokens ?? 0),
      updatedAt: Date.now(),
    })
  })
}

export async function putArtifact(
  entry: Omit<RunArtifact, 'id' | 'createdAt'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await db.runArtifacts.add({ ...entry, id, createdAt: Date.now() })
  return id
}

export async function getArtifacts(
  runId: string,
  kind: RunArtifactKind,
): Promise<RunArtifact[]> {
  const rows = await db.runArtifacts
    .where('[runId+kind]')
    .equals([runId, kind])
    .toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function getArtifact(
  runId: string,
  kind: RunArtifactKind,
): Promise<RunArtifact | undefined> {
  return (await getArtifacts(runId, kind))[0]
}

/** One page's stored JPEG (re-read per call; never held across steps). */
export async function getPageArtifact(
  runId: string,
  pageIndex: number,
): Promise<RunArtifact | undefined> {
  return db.runArtifacts
    .where('[runId+kind+pageIndex]')
    .equals([runId, 'page-jpeg', pageIndex])
    .first()
}

export async function getCropByPath(
  runId: string,
  path: string,
): Promise<RunArtifact | undefined> {
  const crops = await getArtifacts(runId, 'crop')
  return crops.find((crop) => crop.path === path)
}

/** Drops a step's outputs so the executor re-runs it (repair/retry paths). */
export async function clearArtifacts(
  runId: string,
  kind: RunArtifactKind,
): Promise<void> {
  const rows = await getArtifacts(runId, kind)
  await db.runArtifacts.bulkDelete(rows.map((row) => row.id))
}

export async function deleteRun(runId: string): Promise<void> {
  await db.transaction('rw', db.runs, db.runArtifacts, async () => {
    const artifacts = await db.runArtifacts.where('runId').equals(runId).toArray()
    await db.runArtifacts.bulkDelete(artifacts.map((row) => row.id))
    await db.runs.delete(runId)
  })
}

/** Live view of a job's runs, oldest first. undefined while loading. */
export function useJobRuns(jobId: string): RunState[] | undefined {
  return useLiveQuery(
    () => db.runs.where('jobId').equals(jobId).sortBy('createdAt'),
    [jobId],
  )
}

/**
 * User-initiated stop: every unfinished run in the job is marked stopped
 * (artifacts stay — nothing read so far is lost). Finished runs are
 * untouched, so their CSVs remain exportable.
 */
export async function stopJobRuns(jobId: string): Promise<void> {
  const runs = await db.runs.where('jobId').equals(jobId).toArray()
  for (const run of runs) {
    if (run.status === 'running' || run.status === 'paused') {
      await updateRun(run.id, { status: 'stopped', stopReason: 'cancelled' })
    }
  }
}

/** Runs that were interrupted mid-flight and can be resumed. */
export async function findResumableRuns(jobId: string): Promise<RunState[]> {
  const runs = await db.runs.where('jobId').equals(jobId).toArray()
  return runs
    .filter((run) => run.status === 'running' || run.status === 'paused')
    .sort((a, b) => a.createdAt - b.createdAt)
}
