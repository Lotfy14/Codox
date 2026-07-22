import { useCallback, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { CURRENT_JOB_ID, ensureCurrentJob } from './jobs'
import type { AppStep, JobState } from './types'

export { CURRENT_JOB_ID } from './jobs'

/**
 * Live view of any job (the `current` workspace or a persistent Folder) plus
 * its writers. Only the `current` job self-heals via `ensureCurrentJob` — a
 * folder is created explicitly, so a missing folder id stays undefined rather
 * than being conjured back into existence.
 */
export function useJob(jobId: string) {
  const job = useLiveQuery(() => db.jobs.get(jobId), [jobId], null)

  useEffect(() => {
    if (jobId !== CURRENT_JOB_ID || job !== undefined) return
    void ensureCurrentJob()
  }, [jobId, job])

  const setStep = useCallback(
    async (step: AppStep) => {
      await db.jobs.update(jobId, { step })
    },
    [jobId],
  )

  const updateJob = useCallback(
    async (patch: Partial<Omit<JobState, 'id' | 'createdAt'>>) => {
      await db.jobs.update(jobId, patch)
    },
    [jobId],
  )

  return {
    job: job ?? undefined,
    setStep,
    updateJob,
  }
}

export function useCurrentJob() {
  return useJob(CURRENT_JOB_ID)
}
