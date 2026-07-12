import { useRef, useState } from 'react'
import {
  Badge,
  Button,
  FileDropZone,
  FileRow,
  GlassPanel,
  ProgressBar,
  Select,
  StatusChip,
  Toggle,
  TypewriterLine,
} from '../design/components'
import type { SelectOption, StatusChipStatus } from '../design/components'
import { sillySentences } from '../design/silly-sentences'
import {
  exportMessages,
  convertMessages,
  progressMessages,
  reviewMessages,
  uploadMessages,
} from '../copy/messages'
import { batchProgress, isBatchRunning, runProgress } from '../engine/progress'
import { exportableRuns, exportRuns } from '../export/exporter'
import {
  addStoredPdf,
  clearJobPdfs,
  putAnswerKeyPdf,
  removeStoredPdf,
  setPdfAnswerSource,
  useJobPdfs,
} from '../state/files'
import type { AnswerSource, RunState } from '../state/types'
import { CURRENT_JOB_ID, useCurrentJob } from '../state/useCurrentJob'
import { estimatedMinutes, needsAnswerKeyFile } from './convert-logic'
import { useConversion } from './useConversion'
import { downloadRunCsv } from './devCsv'
import { deleteRun } from '../state/runs'
import { useUnresolvedCounts } from './review-data'
import { ReviewStage } from './ReviewStage'
import type { ControllerStatus } from '../providers/controller'

type ConversionStatus = ControllerStatus

/** "Convert another" clears this job's runs; the stored PDFs stay. */
async function clearJobRuns(runs: readonly RunState[]): Promise<void> {
  for (const run of runs) await deleteRun(run.id)
}

const batchSourceOptions: readonly SelectOption<AnswerSource>[] = [
  { id: 'inside', label: 'Inside the PDFs' },
  { id: 'key-file', label: 'In a separate answer key file' },
  { id: 'none', label: 'There are no answers' },
]

/**
 * The real Convert tab: home, files, running, and done stages. Progress is
 * read from the persisted run state, so a reload mid-run redraws the same
 * bars and the executor picks up where it left off.
 */
export function Convert() {
  const { job, updateJob } = useCurrentJob()
  const pdfs = useJobPdfs(CURRENT_JOB_ID)
  const conversion = useConversion(CURRENT_JOB_ID)
  const [notes, setNotes] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [reviewRunId, setReviewRunId] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)

  if (job === undefined || pdfs === undefined) return null

  const exams = pdfs.filter((file) => file.kind === 'exam')
  const answerKey = pdfs.find((file) => file.kind === 'answer-key')
  const batchSource = job.batchAnswerSource ?? 'inside'
  const keepOriginal = job.keepOriginal ?? true
  const totalPages = exams.reduce((sum, file) => sum + file.pageCount, 0)
  const needsKeyFile = needsAnswerKeyFile(batchSource, exams)
  const keyFileMissing = needsKeyFile && answerKey === undefined

  const runs = conversion.runs ?? []
  const hasRuns = runs.length > 0
  const running = isBatchRunning(runs) || conversion.isDriving

  const handleExport = async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      await exportRuns(runs)
    } finally {
      setExportBusy(false)
    }
  }

  const closeReview = () => {
    setReviewRunId(null)
    // Focus returns to the work column, mirroring the mockup's hand-off.
    window.setTimeout(() => sectionRef.current?.focus(), 0)
  }

  const intake = async (files: File[], kind: 'exam' | 'answer-key') => {
    setBusy(true)
    const failed: string[] = []
    try {
      // Loaded on demand so the PDF engine (pdfium WASM + pdf.js) stays
      // out of the app's startup bundle.
      const { EncryptedPdfError, readPdfInfo } = await import('../pdf')
      for (const file of files) {
        try {
          // The open check: page count on success, a plain-English note on
          // failure. A file that cannot be opened is never stored.
          const bytes = new Uint8Array(await file.arrayBuffer())
          const { pageCount } = await readPdfInfo(bytes)
          const entry = {
            jobId: CURRENT_JOB_ID,
            name: file.name,
            size: file.size,
            pageCount,
            blob: file as Blob,
          }
          if (kind === 'answer-key') await putAnswerKeyPdf(entry)
          else await addStoredPdf({ ...entry, kind: 'exam' })
        } catch (error) {
          failed.push(
            error instanceof EncryptedPdfError
              ? uploadMessages.encryptedPdf(file.name)
              : uploadMessages.notPdf(file.name),
          )
        }
      }
    } finally {
      setNotes(failed)
      setBusy(false)
    }
  }

  const inlineNotes = (
    <>
      {busy ? (
        <p className="convert-muted" role="status">
          Reading PDF…
        </p>
      ) : null}
      {notes.map((note) => (
        <p
          className="convert-inline-note convert-inline-note--danger"
          key={note}
          role="status"
        >
          {note}
        </p>
      ))}
    </>
  )

  if (hasRuns) {
    const reviewRun = runs.find((run) => run.id === reviewRunId)
    const exportable = exportableRuns(runs)
    const exported =
      exportable.length > 0 &&
      exportable.every((run) => run.exportedAt !== undefined)
    return (
      <section
        aria-labelledby="convert-heading"
        className="app-tab-screen"
        ref={sectionRef}
        tabIndex={-1}
      >
        <h1 id="convert-heading">Convert</h1>
        {running ? (
          <RunningStage
            providerStatus={conversion.providerStatus}
            runs={runs}
          />
        ) : reviewRun !== undefined ? (
          <ReviewStage
            exported={exported}
            onClose={closeReview}
            onExport={() => void handleExport()}
            run={reviewRun}
          />
        ) : (
          <DoneStage
            exportBusy={exportBusy}
            exported={exported}
            onConvertAnother={() => void clearJobRuns(runs)}
            onExport={() => void handleExport()}
            onOpenReview={setReviewRunId}
            runs={runs}
          />
        )}
      </section>
    )
  }

  return (
    <section aria-labelledby="convert-heading" className="app-tab-screen">
      <h1 id="convert-heading">Convert</h1>
      {exams.length === 0 ? (
        <div className="convert-stack">
          <p>Drop exam PDFs and Codox turns them into Triviadox question sets.</p>
          <GlassPanel aria-label="Start a conversion" as="section" padding="spacious">
            <FileDropZone
              description={convertMessages.dropHint}
              isDisabled={busy}
              label={convertMessages.dropTitle}
              onFiles={(files) => void intake(files, 'exam')}
            />
            {inlineNotes}
          </GlassPanel>
        </div>
      ) : (
        <div className="convert-stack">
          <GlassPanel aria-label="Batch files" as="section" padding="compact">
            <div className="convert-list-header">
              <strong>
                {exams.length} PDF{exams.length === 1 ? '' : 's'} ready
              </strong>
              <Button
                onPress={() => void clearJobPdfs(CURRENT_JOB_ID)}
                variant="quiet"
              >
                Clear
              </Button>
            </div>
            {inlineNotes}
            <div className="convert-row-list" role="list">
              {exams.map((file) => (
                <FileRow
                  answerSource={file.answerSource}
                  isDisabled={busy}
                  key={file.id}
                  name={file.name}
                  onAnswerSourceChange={(source) =>
                    void setPdfAnswerSource(file.id, source)
                  }
                  onRemove={() => void removeStoredPdf(file.id)}
                  role="listitem"
                  size={file.size}
                />
              ))}
            </div>
            <div className="convert-drop-more">
              <FileDropZone
                description={convertMessages.dropMoreHint}
                isDisabled={busy}
                label={convertMessages.dropMoreTitle}
                onFiles={(files) => void intake(files, 'exam')}
              />
            </div>
          </GlassPanel>

          <GlassPanel aria-label="Before you start" as="section" padding="default">
            <div className="convert-field-stack">
              <Select
                description={uploadMessages.declarationHelp}
                label={uploadMessages.declarationQuestion}
                onChange={(source) => {
                  if (source !== null) {
                    void updateJob({ batchAnswerSource: source })
                  }
                }}
                options={batchSourceOptions}
                value={batchSource}
              />
              {needsKeyFile ? (
                <div className="convert-key-file-slot">
                  <p className="convert-inline-note convert-inline-note--info">
                    {uploadMessages.needsKeyFile}
                  </p>
                  {answerKey !== undefined ? (
                    <p className="convert-key-file-added" role="status">
                      ✓ {answerKey.name} added{' '}
                      <Button
                        onPress={() => void removeStoredPdf(answerKey.id)}
                        variant="quiet"
                      >
                        Remove
                      </Button>
                    </p>
                  ) : (
                    <FileDropZone
                      allowsMultiple={false}
                      description={convertMessages.keyDropHint}
                      isDisabled={busy}
                      label={convertMessages.keyDropTitle}
                      onFiles={(files) => void intake(files, 'answer-key')}
                    />
                  )}
                </div>
              ) : null}
              <Toggle
                description="Keeps the PDF stored in Codox so this run can be converted again later. Uses more space."
                isSelected={keepOriginal}
                label="Keep original PDF"
                onChange={(keep) => void updateJob({ keepOriginal: keep })}
              />
            </div>
            <div className="convert-start-row">
              <span className="convert-muted convert-start-note">
                {totalPages} page{totalPages === 1 ? '' : 's'} · about{' '}
                {estimatedMinutes(totalPages)} min
              </span>
              <Button
                isDisabled={busy || keyFileMissing}
                onPress={() => void conversion.start(exams, batchSource)}
              >
                Start converting
              </Button>
            </div>
            {keyFileMissing ? (
              <p className="convert-muted convert-phase-note">
                {uploadMessages.needsKeyFile}
              </p>
            ) : null}
          </GlassPanel>
        </div>
      )}
    </section>
  )
}

/** Maps the live controller status onto the chip's plain-language states. */
function chipStatus(status: ConversionStatus): StatusChipStatus {
  switch (status.kind) {
    case 'paused':
      return status.reason === 'quota' ? 'quota-paused' : 'unreachable'
    case 'wrong-key':
      return 'wrong-key'
    case 'unreachable':
      return 'unreachable'
    default:
      return 'working'
  }
}

/**
 * The running stage. A quota pause reads calm (amber "Paused"), never as
 * an error — it is not one; the run resumes by itself.
 */
function RunningStage({
  providerStatus,
  runs,
}: {
  providerStatus: ConversionStatus
  runs: readonly RunState[]
}) {
  const status = chipStatus(providerStatus)
  const healthy = status === 'working'
  const badPageRun = runs.find((run) => (run.badPages?.length ?? 0) > 0)
  const wrongDeclarationRun = runs.find((run) => run.wrongDeclaration === true)

  const seriousLine =
    status === 'quota-paused'
      ? progressMessages.pausedQuota
      : status === 'unreachable'
        ? progressMessages.geminiUnreachable
        : status === 'wrong-key'
          ? null
          : null

  return (
    <div className="convert-stack">
      <GlassPanel aria-label="Conversion progress" as="section" padding="default">
        <div className="convert-list-header">
          <strong>
            Converting {runs.length} PDF{runs.length === 1 ? '' : 's'}
          </strong>
          <StatusChip status={status} />
        </div>

        <ProgressBar
          label="All pages"
          max={100}
          showFraction={false}
          value={Math.round(batchProgress(runs) * 100)}
        />

        <div className="convert-progress-status" role="status">
          {healthy ? (
            <TypewriterLine sentences={sillySentences} />
          ) : seriousLine !== null ? (
            <p className="convert-inline-note convert-inline-note--info">
              {seriousLine}
            </p>
          ) : null}
          {badPageRun !== undefined ? (
            <p className="convert-inline-note convert-inline-note--info">
              {progressMessages.badPage(
                (badPageRun.badPages?.[0] ?? 0) + 1,
                badPageRun.fileName,
              )}
            </p>
          ) : null}
          {wrongDeclarationRun !== undefined ? (
            <p className="convert-inline-note convert-inline-note--info">
              {progressMessages.wrongDeclaration(wrongDeclarationRun.fileName)}
            </p>
          ) : null}
        </div>

        <div className="convert-row-list" role="list">
          {runs.map((run) => (
            <div className="convert-run-row" key={run.id} role="listitem">
              <ProgressBar
                label={run.fileName}
                max={100}
                showFraction={false}
                value={Math.round(runProgress(run) * 100)}
              />
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  )
}

/**
 * The done stage: the finished-run summary, the Review entry point, and
 * the real Export. Export-early law: the manual export action stays
 * primary and prominent; the only nag is the quiet "Not exported yet"
 * badge.
 */
function DoneStage({
  exportBusy,
  exported,
  onConvertAnother,
  onExport,
  onOpenReview,
  runs,
}: {
  exportBusy: boolean
  exported: boolean
  onConvertAnother: () => void
  onExport: () => void
  onOpenReview: (runId: string) => void
  runs: readonly RunState[]
}) {
  const stopped = runs.filter((run) => run.status === 'stopped')
  const unsafe = runs.filter((run) => run.notSafeToImport === true)
  const done = runs.filter((run) => run.status === 'done')
  const counts = useUnresolvedCounts(done.map((run) => run.id))
  const remaining =
    counts === undefined
      ? undefined
      : Object.values(counts).reduce((sum, count) => sum + count, 0)
  const firstFlagged =
    counts === undefined
      ? undefined
      : done.find((run) => (counts[run.id] ?? 0) > 0)
  const hadFlags = done.some((run) => (run.flaggedRows ?? 0) > 0)

  if (remaining === undefined) return null

  const heading =
    done.length === 0
      ? 'This run stopped.'
      : remaining > 0
        ? progressMessages.finishedWithFlags(remaining)
        : hadFlags
          ? reviewMessages.allResolved
          : progressMessages.finishedClean

  return (
    <div className="convert-stack">
      <GlassPanel aria-label="Conversion finished" as="section" padding="spacious">
        <h2>{heading}</h2>

        {stopped.map((run) => (
          <p
            className="convert-inline-note convert-inline-note--danger"
            key={run.id}
            role="status"
          >
            {run.fileName} stopped: {run.stopReason}. Its pages and everything
            read so far are saved.
          </p>
        ))}

        {unsafe.length > 0 ? (
          <p className="convert-inline-note convert-inline-note--info" role="status">
            {unsafe.length === 1 ? 'One file' : `${unsafe.length} files`} came
            back with checks that did not pass, so
            {unsafe.length === 1 ? ' it is' : ' they are'} marked for your
            review before import. Codox never guesses.
          </p>
        ) : null}

        {remaining > 0 ? (
          <p className="convert-muted">
            {reviewMessages.flagsRemainOnExport(remaining)}
          </p>
        ) : null}

        {exported ? (
          <p
            className="convert-inline-note convert-inline-note--working"
            role="status"
          >
            {exportMessages.exportDone}
          </p>
        ) : null}

        <div className="convert-done-actions">
          {remaining > 0 && firstFlagged !== undefined ? (
            <>
              <Button onPress={() => onOpenReview(firstFlagged.id)}>
                Review {remaining} flag{remaining === 1 ? '' : 's'}
                {done.length > 1 ? ` · ${firstFlagged.fileName}` : ''}
              </Button>
              <Button
                isDisabled={exportBusy || done.length === 0}
                onPress={onExport}
                variant="secondary"
              >
                {exported ? 'Export again' : 'Export as-is'}
              </Button>
            </>
          ) : (
            <Button
              isDisabled={exportBusy || done.length === 0}
              onPress={onExport}
            >
              {exported ? 'Export again' : 'Export bundle'}
            </Button>
          )}
          <Button onPress={onConvertAnother} variant="quiet">
            Convert another
          </Button>
          <Badge tone={exported ? 'success' : 'neutral'}>
            {exported ? exportMessages.exported : exportMessages.notExportedYet}
          </Badge>
        </div>
        <p className="convert-muted convert-phase-note">
          On a phone this opens the share sheet; on desktop it downloads a
          zip. {exportMessages.whyExportMatters}
        </p>

        {import.meta.env.DEV ? (
          <div className="convert-dev-surface">
            <p className="convert-muted">Dev: grade this run in CodoxSandbox</p>
            {done.map((run) => (
              <div className="convert-dev-row" key={run.id}>
                <Button
                  data-testid={`dev-download-csv-${run.id}`}
                  onPress={() => void downloadRunCsv(run)}
                  variant="quiet"
                >
                  Download {run.fileName} CSV
                </Button>
                <span className="convert-muted">
                  {run.requestCount ?? 0} requests · {run.totalTokens ?? 0}{' '}
                  tokens
                  {run.auditUnavailable === true ? ' · audit unavailable' : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </GlassPanel>
    </div>
  )
}
