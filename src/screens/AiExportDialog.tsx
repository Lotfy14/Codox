/**
 * The pre-export dialog for "Export with AI answers": scope + confidence
 * choices (persisted as defaults), an honest quota note, the provenance
 * warning, live solve progress, and provider states in the pinned taxonomy
 * (quota reads as calm "paused", never broken). Solving is abortable;
 * every answered chunk is cached, so a cancel never wastes quota.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, ProgressBar } from '../design/components'
import { aiExportMessages, appMessages } from '../copy/messages'
import {
  clearAiAnswers,
  estimateSolverRequests,
  pendingRows,
  readAiAnswers,
  resolvedRows,
  solveRun,
} from '../engine/solver'
import { exportRuns, exportableRuns, type ExportOutcome } from '../export/exporter'
import { geminiController } from '../providers/controller'
import type { ControllerStatus } from '../providers/controller'
import {
  getAiAnswerSettings,
  saveAiAnswerSettings,
  DEFAULT_AI_ANSWER_SETTINGS,
  type AiAnswerSettings,
  type AiFlagBelow,
  type AiScope,
} from '../state/ai-answers-settings'
import type { RunState } from '../state/types'

export interface AiExportDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** Called with the export outcome after a successful solve + export. */
  onExported: (outcome: ExportOutcome) => void
  runs: readonly RunState[]
}

type Phase = 'configure' | 'solving'

interface ChoiceOption<V extends string> {
  hint: string
  label: string
  value: V
}

const SCOPE_OPTIONS: readonly ChoiceOption<AiScope>[] = [
  {
    value: 'unanswered',
    label: aiExportMessages.scopeUnanswered,
    hint: aiExportMessages.scopeUnansweredHint,
  },
  {
    value: 'unanswered+verify',
    label: aiExportMessages.scopeVerify,
    hint: aiExportMessages.scopeVerifyHint,
  },
  {
    value: 'all',
    label: aiExportMessages.scopeAll,
    hint: aiExportMessages.scopeAllHint,
  },
]

const THRESHOLD_OPTIONS: readonly ChoiceOption<AiFlagBelow>[] = [
  {
    value: 'certain',
    label: aiExportMessages.thresholdCertain,
    hint: aiExportMessages.thresholdCertainHint,
  },
  {
    value: 'likely',
    label: aiExportMessages.thresholdLikely,
    hint: aiExportMessages.thresholdLikelyHint,
  },
  {
    value: 'never',
    label: aiExportMessages.thresholdNever,
    hint: aiExportMessages.thresholdNeverHint,
  },
]

function ChoiceGroup<V extends string>({
  legend,
  onChange,
  options,
  value,
}: {
  legend: string
  onChange: (value: V) => void
  options: readonly ChoiceOption<V>[]
  value: V
}) {
  return (
    <div className="ds-choice-group">
      <p className="ds-choice-group__legend" id={`legend-${legend}`}>
        {legend}
      </p>
      <div aria-label={legend} className="ds-choice-group__options" role="radiogroup">
        {options.map((option) => (
          <button
            aria-checked={value === option.value}
            className="ds-choice"
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            <span className="ds-choice__label">{option.label}</span>
            <span className="ds-choice__hint">{option.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
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

export function AiExportDialog({
  isOpen,
  onOpenChange,
  onExported,
  runs,
}: AiExportDialogProps) {
  const [settings, setSettings] = useState<AiAnswerSettings>(
    DEFAULT_AI_ANSWER_SETTINGS,
  )
  const [phase, setPhase] = useState<Phase>('configure')
  const [pendingRequests, setPendingRequests] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<ControllerStatus>(
    geminiController.getStatus(),
  )
  const [estimateNonce, setEstimateNonce] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const exportable = exportableRuns([...runs])

  useEffect(() => {
    return geminiController.subscribe(() => {
      setProviderStatus(geminiController.getStatus())
    })
  }, [])

  // Load the persisted defaults each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return
    setPhase('configure')
    setError(null)
    void getAiAnswerSettings().then(setSettings)
  }, [isOpen])

  // Honest quota note: count the rows a solve would actually send.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const estimate = async () => {
      let pendingCount = 0
      let newestSave: number | null = null
      for (const run of exportable) {
        const rows = await resolvedRows(run.id)
        const cached = await readAiAnswers(run.id)
        pendingCount += pendingRows(rows, settings.scope, cached).length
        if (cached !== undefined) {
          newestSave = Math.max(newestSave ?? 0, cached.solvedAt)
        }
      }
      if (cancelled) return
      setPendingRequests(estimateSolverRequests(pendingCount))
      setSavedAt(pendingCount === 0 ? newestSave : null)
    }
    void estimate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, settings.scope, estimateNonce, exportable.map((run) => run.id).join('|')])

  const close = (open: boolean) => {
    if (!open) abortRef.current?.abort()
    onOpenChange(open)
  }

  const reSolve = async () => {
    for (const run of exportable) await clearAiAnswers(run.id)
    setEstimateNonce((nonce) => nonce + 1)
  }

  const confirm = async () => {
    if (phase === 'solving') return
    setPhase('solving')
    setError(null)
    const aborter = new AbortController()
    abortRef.current = aborter
    try {
      await saveAiAnswerSettings(settings)

      // Pre-count chunks per run so one bar spans the whole batch.
      const perRun: Array<{ run: RunState; chunks: number }> = []
      for (const run of exportable) {
        const rows = await resolvedRows(run.id)
        const pending = pendingRows(
          rows,
          settings.scope,
          await readAiAnswers(run.id),
        )
        perRun.push({ run, chunks: estimateSolverRequests(pending.length) })
      }
      const total = perRun.reduce((sum, entry) => sum + entry.chunks, 0)
      setProgress({ done: 0, total })

      let base = 0
      for (const { run, chunks } of perRun) {
        const outcome = await solveRun(run.id, settings, {
          signal: aborter.signal,
          onProgress: (done) => setProgress({ done: base + done, total }),
        })
        if (!outcome.ok) {
          if (outcome.failure.kind === 'aborted') {
            setPhase('configure')
            setEstimateNonce((nonce) => nonce + 1)
            return
          }
          setError(
            outcome.failure.kind === 'wrong-key'
              ? aiExportMessages.solveWrongKey
              : aiExportMessages.solveFailed,
          )
          setPhase('configure')
          setEstimateNonce((nonce) => nonce + 1)
          return
        }
        base += chunks
      }

      const outcome = await exportRuns([...runs], { mode: 'ai-answers' })
      onOpenChange(false)
      onExported(outcome)
    } catch {
      setError(aiExportMessages.solveFailed)
      setPhase('configure')
    } finally {
      abortRef.current = null
    }
  }

  const solving = phase === 'solving'
  const pausedLine = solving ? statusLine(providerStatus) : null
  const savedDate =
    savedAt !== null ? new Date(savedAt).toLocaleDateString() : null

  return (
    <Dialog
      description={aiExportMessages.description}
      dismissLabel={appMessages.dialogDismiss}
      isOpen={isOpen}
      onOpenChange={close}
      title={aiExportMessages.title}
    >
      <div className="ds-stack">
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
            <ChoiceGroup
              legend={aiExportMessages.scopeLegend}
              onChange={(scope) => setSettings((s) => ({ ...s, scope }))}
              options={SCOPE_OPTIONS}
              value={settings.scope}
            />
            <ChoiceGroup
              legend={aiExportMessages.thresholdLegend}
              onChange={(flagBelow) => setSettings((s) => ({ ...s, flagBelow }))}
              options={THRESHOLD_OPTIONS}
              value={settings.flagBelow}
            />
            {error !== null ? (
              <p className="ds-inline-note ds-inline-note--danger" role="alert">
                {error}
              </p>
            ) : null}
            <p className="ds-muted" role="status">
              {pendingRequests === null
                ? '…'
                : aiExportMessages.quotaNote(pendingRequests)}
              {savedDate !== null
                ? ` ${aiExportMessages.savedAnswersNote(savedDate)}`
                : null}
            </p>
            <div className="ds-dialog-buttons">
              <Button
                isDisabled={exportable.length === 0}
                onPress={() => void confirm()}
              >
                {aiExportMessages.confirm}
              </Button>
              {savedDate !== null ? (
                <Button onPress={() => void reSolve()} variant="quiet">
                  {aiExportMessages.reSolve}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
