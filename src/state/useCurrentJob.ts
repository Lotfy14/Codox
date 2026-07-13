import { useCallback, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { CURRENT_JOB_ID, ensureCurrentJob } from './jobs'
import type { AppStep, JobState } from './types'

export { CURRENT_JOB_ID } from './jobs'

export function useCurrentJob() {
  const job = useLiveQuery(() => db.jobs.get(CURRENT_JOB_ID), [], null)

  useEffect(() => {
    if (job !== undefined) {
      return
    }

    void ensureCurrentJob()
  }, [job])

  const setStep = useCallback(async (step: AppStep) => {
    await db.jobs.update(CURRENT_JOB_ID, { step })
  }, [])

  const updateJob = useCallback(
    async (patch: Partial<Omit<JobState, 'id' | 'createdAt'>>) => {
      await db.jobs.update(CURRENT_JOB_ID, patch)
    },
    [],
  )

  return {
    job: job ?? undefined,
    setStep,
    updateJob,
  }
}
