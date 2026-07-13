import { useState } from 'react'
import { Badge, Button, Dialog, GlassPanel } from '../design/components'
import type { BadgeTone } from '../design/components'
import { appMessages, historyMessages } from '../copy/messages'
import { deleteHistoryRun, useHistoryRuns } from '../state/history'
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

export function History() {
  const entries = useHistoryRuns()
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const selected = entries?.find((entry) => entry.run.id === deleteRunId)

  const confirmDelete = async () => {
    if (deleteRunId === null || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteHistoryRun(deleteRunId)
      setDeleteRunId(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <section aria-labelledby="history-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="history-heading">{appMessages.navHistory}</h1>
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

              {!isCurrent ? (
                <Button
                  className="history-card__delete"
                  onPress={() => setDeleteRunId(run.id)}
                  variant="quiet"
                >
                  {historyMessages.deleteAction}
                </Button>
              ) : null}
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
    </section>
  )
}
