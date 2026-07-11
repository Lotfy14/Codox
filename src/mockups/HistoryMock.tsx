import { useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  GlassInput,
  GlassPanel,
  Select,
  StorageMeter,
} from '../design/components'
import type { SelectOption } from '../design/components'
import { exportCopy, historyCopy } from './copy'
import { recentRuns } from './mockData'
import type { MockRun } from './mockData'

type RetentionRule = 'auto-clean-days' | 'keep-forever' | 'keep-last-n'

const retentionOptions: readonly SelectOption<RetentionRule>[] = [
  { id: 'keep-forever', label: 'Keep runs until I delete them' },
  { id: 'keep-last-n', label: 'Keep only the last N runs' },
  { id: 'auto-clean-days', label: 'Auto-clean runs older than N days' },
]

export interface HistoryMockProps {
  onOpenReview: () => void
}

/** The History tab: storage row on top, dense solid run rows below. */
export function HistoryMock({ onOpenReview }: HistoryMockProps) {
  const [runs, setRuns] = useState<readonly MockRun[]>(recentRuns)
  const [retention, setRetention] = useState<RetentionRule>('keep-forever')
  const [retentionCount, setRetentionCount] = useState('10')
  const [deleteTarget, setDeleteTarget] = useState<MockRun | null>(null)
  const [statusNote, setStatusNote] = useState('')

  const reExport = (run: MockRun) => {
    setRuns((current) =>
      current.map((candidate) =>
        candidate.id === run.id ? { ...candidate, exported: true } : candidate,
      ),
    )
    setStatusNote(exportCopy.exportDone)
  }

  return (
    <section aria-labelledby="mock-history-heading" className="mock-screen">
      <header className="mock-screen__header">
        <h1 id="mock-history-heading">History</h1>
        <p>Every past run stays on this device until your storage rule cleans it.</p>
      </header>

      <div className="mock-stack">
        <GlassPanel as="section" aria-label="Storage" padding="default">
          <div className="mock-storage-row">
            <div className="mock-field-stack mock-storage-row__controls">
              <Select
                label="Retention"
                onChange={(rule) => {
                  if (rule !== null) setRetention(rule)
                }}
                options={retentionOptions}
                value={retention}
              />
              {retention !== 'keep-forever' ? (
                <GlassInput
                  label={
                    retention === 'keep-last-n' ? 'How many runs' : 'How many days'
                  }
                  onChange={setRetentionCount}
                  value={retentionCount}
                />
              ) : null}
            </div>
            <StorageMeter total={524_288_000} used={126_353_408} />
          </div>
        </GlassPanel>

        <GlassPanel as="section" aria-label="Past runs" padding="compact">
          {statusNote !== '' ? (
            <p className="mock-inline-note mock-inline-note--working" role="status">
              {statusNote}
            </p>
          ) : null}
          <div className="mock-row-list" role="list">
            {runs.map((run) => (
              <div className="mock-run-row mock-run-row--history" key={run.id} role="listitem">
                <div className="mock-run-row__text">
                  <strong>{run.name}</strong>
                  <span className="mock-run-row__meta">
                    {run.date} · {run.questions} questions
                  </span>
                  {!run.keptOriginal ? (
                    <span className="mock-run-row__meta">
                      {historyCopy.reRunNeedsOriginal}
                    </span>
                  ) : null}
                </div>
                <div className="mock-run-row__badges">
                  {run.flagsLeft > 0 ? (
                    <Badge tone="warning">{run.flagsLeft} flags left</Badge>
                  ) : null}
                  <Badge tone={run.exported ? 'success' : 'neutral'}>
                    {run.exported ? exportCopy.exported : exportCopy.notExportedYet}
                  </Badge>
                </div>
                <div className="mock-run-row__actions">
                  <Button onPress={() => reExport(run)} variant="secondary">
                    {run.exported ? 'Re-export' : 'Export'}
                  </Button>
                  {run.flagsLeft > 0 ? (
                    <Button onPress={onOpenReview} variant="secondary">
                      Reopen review
                    </Button>
                  ) : null}
                  <Button isDisabled={!run.keptOriginal} variant="quiet">
                    Re-run
                  </Button>
                  <Button
                    onPress={() => setDeleteTarget(run)}
                    variant="quiet"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {runs.length === 0 ? (
              <p className="mock-muted mock-empty-list">
                No runs yet. Convert a PDF and it appears here.
              </p>
            ) : null}
          </div>
        </GlassPanel>
      </div>

      <Dialog
        actions={(close) => (
          <>
            <Button onPress={close} variant="quiet">
              Cancel
            </Button>
            <Button
              onPress={() => {
                if (deleteTarget !== null) {
                  setRuns((current) =>
                    current.filter((run) => run.id !== deleteTarget.id),
                  )
                }
                close()
              }}
              variant="danger"
            >
              Delete run
            </Button>
          </>
        )}
        description={historyCopy.deleteBody}
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        role="alertdialog"
        title={historyCopy.deleteTitle(deleteTarget?.name ?? 'this run')}
      />
    </section>
  )
}
