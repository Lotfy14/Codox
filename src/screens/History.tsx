import { useState } from 'react'
import { Badge, Button, Dialog, GlassPanel, SplitButton } from '../design/components'
import type { BadgeTone } from '../design/components'
import { appMessages, exportMessages, historyMessages } from '../copy/messages'
import { exportRuns, type ExportMode, type ExportOutcome } from '../export/exporter'
import { AiExportDialog } from './AiExportDialog'
import {
  deleteHistoryRun,
  restoreHistoryRun,
  useHistoryRuns,
} from '../state/history'
import type { RunState } from '../state/types'

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
  const [aiExportRunId, setAiExportRunId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    runId: string
    text: string
    tone: 'info' | 'danger' | 'working'
  } | null>(null)
  const selected = entries?.find((entry) => entry.run.id === deleteRunId)
  const aiExportRun = entries?.find(
    (entry) => entry.run.id === aiExportRunId,
  )?.run

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

  const exportRun = async (run: RunState, mode: ExportMode) => {
    if (actionBusyId !== null) return
    setActionBusyId(run.id)
    setNotice(null)
    try {
      noticeForOutcome(run.id, await exportRuns([run], { mode }))
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
        <p>{historyMessages.retentionNote}</p>
      </header>

      {entries === undefined ? null : entries.length === 0 ? (
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
                {(run.requestCount ?? 0) > 0 ? (
                  <span>{historyMessages.requests(run.requestCount ?? 0)}</span>
                ) : null}
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
                  <SplitButton
                    isPending={actionBusyId === run.id}
                    items={[
                      {
                        id: 'no-answers',
                        label: exportMessages.withoutAnswers,
                        description: exportMessages.withoutAnswersHint,
                      },
                      {
                        id: 'ai-answers',
                        label: exportMessages.withAiAnswers,
                        description: exportMessages.withAiAnswersHint,
                      },
                    ]}
                    menuLabel={exportMessages.menuLabel}
                    onAction={(id) =>
                      id === 'ai-answers'
                        ? setAiExportRunId(run.id)
                        : void exportRun(run, 'no-answers')
                    }
                    onPress={() => void exportRun(run, 'with-answers')}
                    variant="secondary"
                  >
                    {run.exportedAt === undefined
                      ? historyMessages.exportAction
                      : historyMessages.exportAgainAction}
                  </SplitButton>
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

      <AiExportDialog
        isOpen={aiExportRun !== undefined}
        onExported={(outcome) => {
          if (aiExportRunId !== null) noticeForOutcome(aiExportRunId, outcome)
        }}
        onOpenChange={(open) => {
          if (!open) setAiExportRunId(null)
        }}
        runs={aiExportRun === undefined ? [] : [aiExportRun]}
      />
    </section>
  )
}
