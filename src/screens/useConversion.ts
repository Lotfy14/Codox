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
import { geminiController, type ControllerStatus } from '../providers/controller'
import { db } from '../state/db'
import {
  createRun,
  findResumableRuns,
  getRun,
  stopJobRuns,
  updateRun,
  useJobRuns,
} from '../state/runs'
import type { AnswerSource, RunState, StoredPdf } from '../state/types'

export interface ConversionState {
  runs: RunState[] | undefined
  /** Live provider status: working / quota-paused / offline / wrong key. */
  providerStatus: ControllerStatus
  /** True while this tab is driving the batch. */
  isDriving: boolean
  start: (
    exams: readonly StoredPdf[],
    answerKey: StoredPdf | undefined,
    batchSource: AnswerSource,
  ) => Promise<void>
  /** Re-enters provider-stopped runs from their persisted checkpoint. */
  retry: (runIds: readonly string[]) => Promise<void>
  /** User stop: aborts in-flight work, marks unfinished runs stopped. */
  stop: () => Promise<void>
  outcomes: RunOutcome[]
}

/** The declaration that applies to one file: its override, else the batch. */
export function effectiveAnswerSource(
  file: Pick<StoredPdf, 'answerSource'>,
  batchSource: AnswerSource,
): AnswerSource {
  return file.answerSource ?? batchSource
}

interface QueueItem {
  run: RunState
  bytes: Uint8Array
  examPageCount: number
  declared: AnswerSource | undefined
  answerKey?: {
    bytes: Uint8Array
    pageCount: number
  }
}

async function answerKeyForRun(
  run: RunState,
  exam: StoredPdf,
  declared: AnswerSource,
): Promise<StoredPdf | undefined> {
  if (declared !== 'key-file') return undefined
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
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([])
  // One driver at a time, even across re-renders and StrictMode remounts.
  const driving = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return geminiController.subscribe(() => {
      setProviderStatus(geminiController.getStatus())
    })
  }, [])

  const drive = useCallback(
    async (
      queue: ReadonlyArray<QueueItem>,
    ) => {
      if (driving.current) return
      driving.current = true
      setIsDriving(true)
      const aborter = new AbortController()
      abortRef.current = aborter
      try {
        for (const item of queue) {
          if (aborter.signal.aborted) break
          try {
            // One file's stop never kills the batch: the outcome is recorded
            // and the next file starts.
            const outcome = await executeRun(item.run.id, item.bytes, item.declared, {
              signal: aborter.signal,
              examPageCount: item.examPageCount,
              answerKeyBytes: item.answerKey?.bytes,
              answerKeyPageCount: item.answerKey?.pageCount,
            })
            setOutcomes((previous) => [...previous, outcome])
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
        setIsDriving(false)
      }
    },
    [jobId],
  )

  const stopConversion = useCallback(async () => {
    abortRef.current?.abort()
    // No driver (stale state from a crash or another tab): nothing will
    // run the cleanup above, so mark the runs stopped right here.
    if (!driving.current) await stopJobRuns(jobId)
  }, [jobId])

  /** Resume anything a reload or a closed tab left mid-flight. */
  useEffect(() => {
    let cancelled = false
    const resume = async () => {
      const resumable = await findResumableRuns(jobId)
      if (cancelled || resumable.length === 0 || driving.current) return
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
        const job = await db.jobs.get(run.jobId)
        const declared = effectiveAnswerSource(
          file,
          job?.batchAnswerSource ?? 'inside',
        )
        const answerKey = await answerKeyForRun(run, file, declared)
        queue.push({
          run,
          bytes: new Uint8Array(await file.blob.arrayBuffer()),
          examPageCount: file.pageCount,
          declared,
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
      batchSource: AnswerSource,
    ) => {
      const queue: QueueItem[] = []
      for (const exam of exams) {
        const declared = effectiveAnswerSource(exam, batchSource)
        const usedAnswerKey = declared === 'key-file' ? answerKey : undefined
        const runId = await createRun({
          jobId,
          pdfId: exam.id,
          answerKeyPdfId: usedAnswerKey?.id,
          fileName: exam.name,
          pageCount: exam.pageCount + (usedAnswerKey?.pageCount ?? 0),
        })
        const run = await getRun(runId)
        if (run === undefined) continue
        queue.push({
          run,
          bytes: new Uint8Array(await exam.blob.arrayBuffer()),
          examPageCount: exam.pageCount,
          declared,
          ...(usedAnswerKey === undefined
            ? {}
            : {
                answerKey: {
                  bytes: new Uint8Array(await usedAnswerKey.blob.arrayBuffer()),
                  pageCount: usedAnswerKey.pageCount,
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
        const job = await db.jobs.get(run.jobId)
        await updateRun(run.id, { status: 'paused', stopReason: undefined })
        const declared = effectiveAnswerSource(
          file,
          job?.batchAnswerSource ?? 'inside',
        )
        const answerKey = await answerKeyForRun(run, file, declared)
        queue.push({
          run,
          bytes: new Uint8Array(await file.blob.arrayBuffer()),
          examPageCount: file.pageCount,
          declared,
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
    isDriving,
    start,
    retry,
    stop: stopConversion,
    outcomes,
  }
}
