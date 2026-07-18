/**
 * The Convert screen's engine driver: starts one run per exam PDF and
 * executes them sequentially (one file's stop never kills the batch),
 * resumes anything left mid-flight by a reload, and surfaces the
 * controller's pause states.
 *
 * All durable state lives in Dexie — this hook holds no run data of its
 * own, so a reload mid-run redraws the same bars and picks up where it
 * left off.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { executeRun, type RunOutcome } from '../engine/executor'
import { matchRunTopics } from '../engine/topic-matcher'
import { geminiController, type ControllerStatus } from '../providers/controller'
import { getCustomizationSettings } from '../state/customization-settings'
import { db } from '../state/db'
import {
  createRun,
  findResumableRuns,
  getRun,
  putArtifact,
  stopJobRuns,
  updateRun,
  useJobRuns,
} from '../state/runs'
import type { RunState, StoredPdf } from '../state/types'

export interface ConversionState {
  runs: RunState[] | undefined
  /** Live provider status: working / quota-paused / offline / wrong key. */
  providerStatus: ControllerStatus
  /** True while this tab is driving the batch. */
  isDriving: boolean
  /** True while post-run topic matching is in flight. */
  isMatching: boolean
  /** Why the last topic-matching attempt stopped, if it did. */
  topicMatchIssue: 'wrong-key' | 'failed' | null
  start: (
    exams: readonly StoredPdf[],
    answerKey: StoredPdf | undefined,
  ) => Promise<void>
  /** Re-enters provider-stopped runs from their persisted checkpoint. */
  retry: (runIds: readonly string[]) => Promise<void>
  /** Re-runs topic matching for rows that never got a cached match. */
  retryTopicMatching: (runIds: readonly string[]) => Promise<void>
  /** User stop: aborts in-flight work, marks unfinished runs stopped. */
  stop: () => Promise<void>
  outcomes: RunOutcome[]
}

interface QueueItem {
  run: RunState
  bytes: Uint8Array
  examPageCount: number
  answerKey?: {
    bytes: Uint8Array
    pageCount: number
  }
}

let globalDriving = false

/**
 * The answer key that travels with a run: the run's pinned key if it still
 * exists, else the job's key file. The planner decides from evidence what
 * the extra pages mean — a key is always attached when one is present.
 */
async function answerKeyForRun(
  run: RunState,
  exam: StoredPdf,
): Promise<StoredPdf | undefined> {
  if (run.answerKeyPdfId !== undefined) {
    const pinned = await db.files.get(run.answerKeyPdfId)
    if (pinned !== undefined) return pinned
  }
  const files = await db.files.where('jobId').equals(exam.jobId).toArray()
  return files.find((file) => file.kind === 'answer-key')
}

export function useConversion(jobId: string): ConversionState {
  const runs = useJobRuns(jobId)
  const [providerStatus, setProviderStatus] = useState<ControllerStatus>(
    geminiController.getStatus(),
  )
  const [isDriving, setIsDriving] = useState(false)
  const [isMatching, setIsMatching] = useState(false)
  const [topicMatchIssue, setTopicMatchIssue] = useState<
    'wrong-key' | 'failed' | null
  >(null)
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([])
  // One driver at a time, even across re-renders and StrictMode remounts.
  const driving = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  /**
   * Post-run topic matching — strictly after extraction, outside the
   * engine path. A run without a topics-list snapshot is a no-op; any
   * failure is recorded for the done-stage note and never touches the
   * run's status (extraction success and matching are independent).
   */
  const matchTopics = useCallback(
    async (runIds: readonly string[], signal?: AbortSignal) => {
      setIsMatching(true)
      setTopicMatchIssue(null)
      try {
        for (const runId of runIds) {
          const run = await getRun(runId)
          if (run?.status !== 'done') continue
          const outcome = await matchRunTopics(runId, { signal })
          if (!outcome.ok && outcome.failure.kind !== 'aborted') {
            setTopicMatchIssue(
              outcome.failure.kind === 'wrong-key' ? 'wrong-key' : 'failed',
            )
            return
          }
        }
      } catch {
        setTopicMatchIssue('failed')
      } finally {
        setIsMatching(false)
      }
    },
    [],
  )

  useEffect(() => {
    return geminiController.subscribe(() => {
      setProviderStatus(geminiController.getStatus())
    })
  }, [])

  const drive = useCallback(
    async (
      queue: ReadonlyArray<QueueItem>,
    ) => {
      if (driving.current || globalDriving) return
      driving.current = true
      globalDriving = true
      setIsDriving(true)
      const aborter = new AbortController()
      abortRef.current = aborter
      try {
        // Engine-shaping settings are read once per batch, at drive time, so
        // start, retry, and resume all honor the current Customize choices.
        const settings = await getCustomizationSettings()
        for (const item of queue) {
          if (aborter.signal.aborted) break
          try {
            // One file's stop never kills the batch: the outcome is recorded
            // and the next file starts.
            const outcome = await executeRun(item.run.id, item.bytes, {
              signal: aborter.signal,
              examPageCount: item.examPageCount,
              answerKeyBytes: item.answerKey?.bytes,
              answerKeyPageCount: item.answerKey?.pageCount,
              boxPagesPerCall: settings.boxPagesPerCall,
              chunkSize: settings.workerChunkSize,
              matchingMode: settings.matchingMode,
            })
            setOutcomes((previous) => [...previous, outcome])
            // Label the finished run against the user's topic list before
            // the next file starts (no-op without a topics-list snapshot).
            await matchTopics([item.run.id], aborter.signal)
          } catch {
            // An unexpected crash must never leave a run 'running' forever
            // (an undriven run locks the screen with a frozen bar).
            await updateRun(item.run.id, {
              status: 'stopped',
              stopReason: 'unexpected_error',
            })
          }
        }
      } finally {
        // A user stop lands here after the in-flight run has settled, so
        // this 'stopped' write can never be overwritten by a late 'paused'.
        if (aborter.signal.aborted) await stopJobRuns(jobId)
        driving.current = false
        globalDriving = false
        setIsDriving(false)
      }
    },
    [jobId, matchTopics],
  )

  const stopConversion = useCallback(async () => {
    abortRef.current?.abort()
    // No driver (stale state from a crash or another tab): nothing will
    // run the cleanup above, so mark the runs stopped right here.
    if (!driving.current) {
      await stopJobRuns(jobId)
      globalDriving = false
    }
  }, [jobId])

  /** Resume anything a reload or a closed tab left mid-flight. */
  useEffect(() => {
    let cancelled = false
    const resume = async () => {
      const resumable = await findResumableRuns(jobId)
      if (cancelled || resumable.length === 0 || driving.current || globalDriving) return
      const queue: QueueItem[] = []
      for (const run of resumable) {
        const file = await db.files.get(run.pdfId)
        if (file === undefined) {
          // Source PDF gone: the run can never proceed. Leaving it
          // 'running' would freeze the progress screen forever.
          await updateRun(run.id, {
            status: 'stopped',
            stopReason: 'source_pdf_missing',
          })
          continue
        }
        const answerKey = await answerKeyForRun(run, file)
        queue.push({
          run,
          bytes: new Uint8Array(await file.blob.arrayBuffer()),
          examPageCount: file.pageCount,
          ...(answerKey === undefined
            ? {}
            : {
                answerKey: {
                  bytes: new Uint8Array(await answerKey.blob.arrayBuffer()),
                  pageCount: answerKey.pageCount,
                },
              }),
        })
      }
      if (!cancelled && queue.length > 0) await drive(queue)
    }
    void resume()
    return () => {
      cancelled = true
    }
  }, [jobId, drive])

  const start = useCallback(
    async (
      exams: readonly StoredPdf[],
      answerKey: StoredPdf | undefined,
    ) => {
      // Snapshot the Customizations choices and the job's inputs once per
      // batch: History exports keep the columns a run was made with,
      // whatever the user changes afterwards.
      const settings = await getCustomizationSettings()
      const job = await db.jobs.get(jobId)
      const topics =
        settings.topicsMode === 'on' ? (job?.topics ?? []) : []
      const typedYear =
        settings.yearMode === 'type' ? (job?.typedYear ?? '').trim() : ''
      const queue: QueueItem[] = []
      for (const exam of exams) {
        const runId = await createRun({
          jobId,
          pdfId: exam.id,
          answerKeyPdfId: answerKey?.id,
          fileName: exam.name,
          pageCount: exam.pageCount + (answerKey?.pageCount ?? 0),
          yearMode: settings.yearMode,
          ...(typedYear === '' ? {} : { typedYear }),
        })
        if (topics.length > 0) {
          await putArtifact({ runId, kind: 'topics-list', json: { topics } })
        }
        const run = await getRun(runId)
        if (run === undefined) continue
        queue.push({
          run,
          bytes: new Uint8Array(await exam.blob.arrayBuffer()),
          examPageCount: exam.pageCount,
          ...(answerKey === undefined
            ? {}
            : {
                answerKey: {
                  bytes: new Uint8Array(await answerKey.blob.arrayBuffer()),
                  pageCount: answerKey.pageCount,
                },
              }),
        })
      }
      await drive(queue)
    },
    [jobId, drive],
  )

  const retry = useCallback(
    async (runIds: readonly string[]) => {
      const queue: QueueItem[] = []
      for (const runId of runIds) {
        const run = await getRun(runId)
        if (run === undefined) continue
        const file = await db.files.get(run.pdfId)
        if (file === undefined) {
          await updateRun(run.id, {
            status: 'stopped',
            stopReason: 'source_pdf_missing',
          })
          continue
        }
        await updateRun(run.id, { status: 'paused', stopReason: undefined })
        const answerKey = await answerKeyForRun(run, file)
        queue.push({
          run,
          bytes: new Uint8Array(await file.blob.arrayBuffer()),
          examPageCount: file.pageCount,
          ...(answerKey === undefined
            ? {}
            : {
                answerKey: {
                  bytes: new Uint8Array(await answerKey.blob.arrayBuffer()),
                  pageCount: answerKey.pageCount,
                },
              }),
        })
      }
      if (queue.length > 0) await drive(queue)
    },
    [drive],
  )

  return {
    runs,
    providerStatus,
    isDriving: isDriving || globalDriving,
    isMatching,
    topicMatchIssue,
    start,
    retry,
    retryTopicMatching: matchTopics,
    stop: stopConversion,
    outcomes,
  }
}
