import { useCallback, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { AppStep, JobState } from './types'

const CURRENT_JOB_ID = 'current'

async function createCurrentJob(): Promise<void> {
  const newJob: JobState = {
    id: CURRENT_JOB_ID,
    createdAt: Date.now(),
    step: 'setup',
  }

  try {
    await db.jobs.add(newJob)
  } catch (error) {
    const createdByConcurrentRead = await db.jobs.get(CURRENT_JOB_ID)

    if (createdByConcurrentRead) {
      return
    }

    throw error
  }
}

export function useCurrentJob() {
  const job = useLiveQuery(() => db.jobs.get(CURRENT_JOB_ID), [], null)

  useEffect(() => {
    if (job !== undefined) {
      return
    }

    void createCurrentJob()
  }, [job])

  const setStep = useCallback(async (step: AppStep) => {
    await db.jobs.update(CURRENT_JOB_ID, { step })
  }, [])

  return {
    job: job ?? undefined,
    setStep,
  }
}
