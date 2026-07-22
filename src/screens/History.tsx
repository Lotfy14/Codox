import { useMemo, useState } from 'react'
import { Badge, Button, Dialog, GlassPanel } from '../design/components'
import type { BadgeTone } from '../design/components'
import { appMessages, exportMessages, historyMessages } from '../copy/messages'
import {
  countUnexportedFlagged,
  exportRuns,
  exportToTriviadox,
  triviadoxImportUrl,
  type ExportOutcome,
} from '../export/exporter'
import { ExportButton } from './ExportButton'
import { useCustomizationSettings } from '../state/customization-settings'
import {
  deleteHistoryRun,
  restoreHistoryRun,
  useHistoryRuns,
} from '../state/history'
import type { RunState } from '../state/types'
import { ReviewExperience } from './ReviewExperience'
import { useReviewSession } from './useReviewSession'

function statusTone(status: RunState['status']): BadgeTone {
  switch (status) {
    case 'done':
      return 'success'
    case 'running':
      return 'primary'
    case 'paused':
      return 'warning'
    case 'stopped':
      return 'danger'
  }
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export interface HistoryProps {
  onOpenConvert: () => void
}

export function History({ onOpenConvert }: HistoryProps) {
  const entries = useHistoryRuns()
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [reviewRunId, setReviewRunId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    runId: string
    text: string
    tone: 'info' | 'danger' | 'working'
  } | null>(null)
  // Export first warns when a run still has questions needing review; only
  // the resolved ones ship (owner-approved 2026-07-21).
  const [exportPrompt, setExportPrompt] = useState<{
    run: RunState
    count: number
  } | null>(null)
  const exportTarget = useCustomizationSettings()?.exportTarget ?? 'triviadox'
  const selected = entries?.find((entry) => entry.run.id === deleteRunId)
  const reviewRun = entries?.find((entry) => entry.run.id === reviewRunId)?.run
  const reviewRuns = useMemo(() => reviewRun === undefined ? [] : [reviewRun], [reviewRun])
  const reviewSession = useReviewSession(reviewRuns)

  const confirmDelete = async () => {
    if (deleteRunId === null || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteHistoryRun(deleteRunId)
      setDeleteRunId(null)
    } catch {
      setNotice({
        runId: deleteRunId,
        text: historyMessages.deleteFailed,
        tone: 'danger',
      })
    } finally {
      setDeleteBusy(false)
    }
  }

  const noticeForOutcome = (runId: string, outcome: ExportOutcome) => {
    setNotice({
      runId,
      text:
        outcome === 'cancelled'
          ? historyMessages.exportCancelled
          : outcome === 'nothing'
            ? historyMessages.exportUnavailable
            : outcome === 'downloaded'
              ? historyMessages.exportDownloaded
              : historyMessages.exportComplete,
      tone:
        outcome === 'cancelled' || outcome === 'nothing' ? 'info' : 'working',
    })
  }

  /**
   * Export entry point: warn when the run still has questions needing
   * review (only resolved ones ship), else export straight away.
   */
  const exportRun = async (run: RunState) => {
    if (actionBusyId !== null || exportPrompt !== null) return
    const heldBack = await countUnexportedFlagged([run])
    if (heldBack > 0) {
      setExportPrompt({ run, count: heldBack })
      return
    }
    await performExportRun(run)
  }

  /** Ships the run's resolved questions to the customized destination. */
  const performExportRun = async (run: RunState) => {
    if (actionBusyId !== null) return
    setActionBusyId(run.id)
    setNotice(null)
    try {
      if (exportTarget === 'triviadox') {
        const res = await exportToTriviadox([run])
        if (res.success && res.id) {
          window.open(triviadoxImportUrl(res.id), '_blank')
          setNotice({
            runId: run.id,
            text: exportMessages.triviadoxDone,
            tone: 'working',
          })
        } else {
          setNotice({
            runId: run.id,
            text:
              res.error === 'nothing'
                ? historyMessages.exportUnavailable
                : historyMessages.exportFailed,
            tone: res.error === 'nothing' ? 'info' : 'danger',
          })
        }
      } else {
        noticeForOutcome(run.id, await exportRuns([run]))
      }
    } catch {
      setNotice({
        runId: run.id,
        text: historyMessages.exportFailed,
        tone: 'danger',
      })
    } finally {
      setActionBusyId(null)
    }
  }

  const handleUseAgain = async (runId: string) => {
    if (actionBusyId !== null) return
    setActionBusyId(runId)
    setNotice(null)
    try {
      const result = await restoreHistoryRun(runId)
      if (result === 'restored') {
        onOpenConvert()
        return
      }
      setNotice({
        runId,
        text:
          result === 'current-not-empty'
            ? historyMessages.currentNotEmpty
            : historyMessages.reRunNeedsOriginal,
        tone: 'info',
      })
    } catch {
      setNotice({
        runId,
        text: historyMessages.restoreFailed,
        tone: 'danger',
      })
    } finally {
      setActionBusyId(null)
    }
  }

  return (
    <section aria-labelledby="history-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="history-heading">{appMessages.navHistory}</h1>
      </header>

      {reviewRun !== undefined ? (
        <div className="ds-stack">
          <div>
            <Button onPress={() => setReviewRunId(null)} variant="quiet">
              {historyMessages.backToHistory}
            </Button>
          </div>
          <ReviewExperience
            onExport={() => void exportRun(reviewRun)}
            runs={reviewRuns}
            session={reviewSession}
          />
        </div>
      ) : entries === undefined ? null : entries.length === 0 ? (
        <GlassPanel as="div" padding="default">
          <div className="ds-empty-state">
            <h2>{historyMessages.emptyTitle}</h2>
            <p>{historyMessages.emptyBody}</p>
          </div>
        </GlassPanel>
      ) : (
        <div className="history-list" role="list">
          {entries.map(({ isCurrent, originalKept, run }) => (
            <GlassPanel
              as="article"
              className="history-card"
              key={run.id}
              padding="default"
              role="listitem"
            >
              <div className="history-card__head">
                <div>
                  <h2>{run.fileName}</h2>
                  <p>{formatDate(run.updatedAt)}</p>
                </div>
                <Badge tone={statusTone(run.status)}>
                  {historyMessages.status[run.status]}
                </Badge>
              </div>

              <div className="history-card__meta">
                {isCurrent ? (
                  <Badge tone="primary">{historyMessages.current}</Badge>
                ) : null}
                <span>
                  {historyMessages.pages(run.pageCount ?? run.pagesRendered ?? 0)}
                </span>
                <span>
                  {run.exportedAt === undefined
                    ? historyMessages.notExported
                    : historyMessages.exported}
                </span>
                <span>
                  {originalKept
                    ? historyMessages.originalKept
                    : historyMessages.originalRemoved}
                </span>
              </div>

              {notice?.runId === run.id ? (
                <p
                  className={`ds-inline-note ds-inline-note--${notice.tone}`}
                  role="status"
                >
                  {notice.text}
                </p>
              ) : null}

              <div className="history-card__actions">
                {run.status === 'done' ? (
                  <>
                    <Button onPress={() => setReviewRunId(run.id)} variant="quiet">
                      {historyMessages.reviewAction}
                    </Button>
                    <ExportButton
                      isPending={actionBusyId === run.id}
                      onPress={() => void exportRun(run)}
                      target={exportTarget}
                      variant="secondary"
                    />
                  </>
                ) : null}
                {!isCurrent && originalKept ? (
                  <Button
                    isDisabled={actionBusyId !== null}
                    onPress={() => void handleUseAgain(run.id)}
                    variant="quiet"
                  >
                    {historyMessages.useAgainAction}
                  </Button>
                ) : null}
                {!isCurrent ? (
                  <Button
                    className="history-card__delete"
                    isDisabled={actionBusyId !== null}
                    onPress={() => setDeleteRunId(run.id)}
                    variant="quiet"
                  >
                    {historyMessages.deleteAction}
                  </Button>
                ) : null}
              </div>
            </GlassPanel>
          ))}
        </div>
      )}

      <Dialog
        actions={(close) => (
          <>
            <Button onPress={close} variant="quiet">
              {historyMessages.cancelDelete}
            </Button>
            <Button
              isPending={deleteBusy}
              onPress={() => void confirmDelete()}
              variant="danger"
            >
              {historyMessages.confirmDelete}
            </Button>
          </>
        )}
        dismissLabel={appMessages.dialogDismiss}
        isOpen={selected !== undefined}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteRunId(null)
        }}
        title={historyMessages.deleteTitle(selected?.run.fileName ?? '')}
      >
        <p className="ds-muted">{historyMessages.deleteBody}</p>
      </Dialog>

      <Dialog
        description={
          exportPrompt !== null
            ? exportMessages.holdbackBody(exportPrompt.count)
            : ''
        }
        dismissLabel={appMessages.dialogDismiss}
        isOpen={exportPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setExportPrompt(null)
        }}
        role="alertdialog"
        title={exportMessages.holdbackTitle}
        actions={(close) => (
          <>
            <Button onPress={close} variant="secondary">
              {exportMessages.holdbackCancel}
            </Button>
            <Button
              onPress={() => {
                const run = exportPrompt?.run
                close()
                if (run !== undefined) void performExportRun(run)
              }}
            >
              {exportMessages.holdbackConfirm}
            </Button>
          </>
        )}
      />

    </section>
  )
}
