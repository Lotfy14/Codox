/**
 * The Review screen's "AI answers" dialog — solve-only, no export. The
 * user can ask Gemini about the whole file (cached rows are skipped) and
 * then explicitly approve switching answers: the summary states exactly
 * how many blanks get filled and how many existing answers change before
 * anything is written. Approved switches become ordinary review
 * resolutions; engine output is never modified (NEVER-GUESS intact — the
 * approval click is the human decision).
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, ProgressBar } from '../design/components'
import {
  aiExportMessages,
  aiReviewMessages,
  appMessages,
} from '../copy/messages'
import type { AiAnswer } from '../engine/solver'
import {
  clearAiAnswers,
  estimateSolverRequests,
  solveRows,
} from '../engine/solver'
import { geminiController } from '../providers/controller'
import type { ControllerStatus } from '../providers/controller'
import type { RunState } from '../state/types'
import {
  aiApplyPlan,
  saveResolutions,
  type Resolutions,
  type ReviewRow,
} from './review-data'

export interface AiReviewDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  run: RunState
  /** The rows as the tutor sees them (edits applied). */
  reviewRows: readonly ReviewRow[]
  resolutions: Resolutions
  aiAnswers: Record<string, AiAnswer> | undefined
}

/** Provider status → the calm line under the progress bar, if any. */
function statusLine(status: ControllerStatus): string | null {
  if (status.kind === 'paused') {
    return status.reason === 'quota'
      ? aiExportMessages.solvePausedQuota
      : aiExportMessages.solveUnreachable
  }
  if (status.kind === 'wrong-key') return aiExportMessages.solveWrongKey
  if (status.kind === 'unreachable') return aiExportMessages.solveUnreachable
  return null
}

export function AiReviewDialog({
  isOpen,
  onOpenChange,
  run,
  reviewRows,
  resolutions,
  aiAnswers,
}: AiReviewDialogProps) {
  const [solving, setSolving] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [providerStatus, setProviderStatus] = useState<ControllerStatus>(
    geminiController.getStatus(),
  )
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return geminiController.subscribe(() => {
      setProviderStatus(geminiController.getStatus())
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setAppliedCount(null)
  }, [isOpen])

  const answers = aiAnswers ?? {}
  const total = reviewRows.length
  const answeredCount = reviewRows.filter(
    (row) => answers[row.row.id] !== undefined,
  ).length
  const pendingIds = reviewRows
    .filter((row) => answers[row.row.id] === undefined)
    .map((row) => row.row.id)
  const plan = aiApplyPlan(reviewRows, resolutions, answers)
  const switchCount = plan.fillCount + plan.differCount

  const close = (open: boolean) => {
    if (!open) abortRef.current?.abort()
    onOpenChange(open)
  }

  const solve = async (rowIds: readonly string[], clearFirst: boolean) => {
    if (solving || rowIds.length === 0) return
    setSolving(true)
    setError(null)
    setAppliedCount(null)
    const aborter = new AbortController()
    abortRef.current = aborter
    try {
      if (clearFirst) await clearAiAnswers(run.id)
      const outcome = await solveRows(run.id, rowIds, {
        signal: aborter.signal,
        onProgress: (done, chunkCount) =>
          setProgress({ done, total: chunkCount }),
      })
      if (!outcome.ok && outcome.failure.kind !== 'aborted') {
        setError(
          outcome.failure.kind === 'wrong-key'
            ? aiExportMessages.solveWrongKey
            : aiExportMessages.solveFailed,
        )
      }
    } catch {
      setError(aiExportMessages.solveFailed)
    } finally {
      setSolving(false)
      abortRef.current = null
    }
  }

  const apply = async () => {
    if (switchCount === 0) return
    await saveResolutions(run.id, plan.picks)
    setAppliedCount(switchCount)
  }

  const pausedLine = solving ? statusLine(providerStatus) : null

  return (
    <Dialog
      description={aiReviewMessages.dialogDescription}
      dismissLabel={appMessages.dialogDismiss}
      isOpen={isOpen}
      onOpenChange={close}
      title={aiReviewMessages.dialogTitle}
    >
      <div className="ds-stack">
        <p className="ds-muted" role="status">
          {answeredCount === 0
            ? aiReviewMessages.noneYet
            : aiReviewMessages.coverage(answeredCount, total)}
        </p>

        {solving ? (
          <>
            <ProgressBar
              label={aiExportMessages.solving(progress.done, progress.total)}
              max={Math.max(progress.total, 1)}
              value={progress.done}
            />
            {pausedLine !== null ? (
              <p className="ds-inline-note ds-inline-note--info">{pausedLine}</p>
            ) : null}
            <div className="ds-dialog-buttons">
              <Button onPress={() => abortRef.current?.abort()} variant="secondary">
                {aiExportMessages.cancel}
              </Button>
            </div>
          </>
        ) : (
          <>
            {error !== null ? (
              <p className="ds-inline-note ds-inline-note--danger" role="alert">
                {error}
              </p>
            ) : null}

            {pendingIds.length > 0 ? (
              <>
                <Button onPress={() => void solve(pendingIds, false)}>
                  {answeredCount === 0
                    ? aiReviewMessages.askAll(total)
                    : aiReviewMessages.askRemaining(pendingIds.length)}
                </Button>
                <p className="ds-muted">
                  {aiExportMessages.quotaNote(
                    estimateSolverRequests(pendingIds.length),
                  )}
                </p>
              </>
            ) : null}

            {answeredCount > 0 ? (
              <section
                aria-label={aiReviewMessages.applyLegend}
                className="ai-review-apply"
              >
                <h3 className="ai-review-apply__heading">
                  {aiReviewMessages.applyLegend}
                </h3>
                <ul className="ai-review-apply__summary">
                  {plan.fillCount > 0 ? (
                    <li>{aiReviewMessages.summaryFill(plan.fillCount)}</li>
                  ) : null}
                  {plan.differCount > 0 ? (
                    <li>{aiReviewMessages.summaryDiffer(plan.differCount)}</li>
                  ) : null}
                  {plan.agreeCount > 0 ? (
                    <li>{aiReviewMessages.summaryAgree(plan.agreeCount)}</li>
                  ) : null}
                  {plan.unsureCount > 0 ? (
                    <li>{aiReviewMessages.summaryUnsure(plan.unsureCount)}</li>
                  ) : null}
                </ul>
                {appliedCount !== null ? (
                  <p className="ds-inline-note ds-inline-note--working" role="status">
                    {aiReviewMessages.appliedNote(appliedCount)}
                  </p>
                ) : switchCount === 0 ? (
                  <p className="ds-muted">{aiReviewMessages.nothingToApply}</p>
                ) : null}
                <div className="ds-dialog-buttons">
                  {switchCount > 0 ? (
                    <Button onPress={() => void apply()}>
                      {aiReviewMessages.applyButton(switchCount)}
                    </Button>
                  ) : null}
                  <Button
                    onPress={() =>
                      void solve(
                        reviewRows.map((row) => row.row.id),
                        true,
                      )
                    }
                    variant="quiet"
                  >
                    {aiReviewMessages.askAgainAll}
                  </Button>
                </div>
              </section>
            ) : null}

            <div className="ds-dialog-buttons">
              <Button onPress={() => close(false)} variant="secondary">
                {aiReviewMessages.close}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
