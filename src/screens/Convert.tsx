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
  convertMessages,
  exportMessages,
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
import { useGeminiCredential } from '../state/credentials'

type ConversionStatus = ControllerStatus

/** "Convert another" clears this job's runs; the stored PDFs stay. */
async function clearJobRuns(runs: readonly RunState[]): Promise<void> {
  for (const run of runs) await deleteRun(run.id)
}

const batchSourceOptions: readonly SelectOption<AnswerSource>[] = [
  { id: 'inside', label: uploadMessages.insidePdfs },
  { id: 'key-file', label: uploadMessages.inSeparateKeyFile },
  { id: 'none', label: uploadMessages.noAnswers },
]

const fileAnswerSourceLabels = {
  'batch-default': uploadMessages.batchDefault,
  inside: uploadMessages.insideThisPdf,
  'key-file': uploadMessages.separateKeyFile,
  none: uploadMessages.noAnswersProvided,
} as const

const answersShort: Record<AnswerSource, string> = {
  inside: uploadMessages.answersShortInside,
  'key-file': uploadMessages.answersShortKeyFile,
  none: uploadMessages.answersShortNone,
}

/** Pill text resolves "batch default" to the batch's actual declaration. */
function answersPillLabels(batchSource: AnswerSource) {
  return {
    'batch-default': uploadMessages.answersPill(answersShort[batchSource]),
    inside: uploadMessages.answersPill(answersShort.inside),
    'key-file': uploadMessages.answersPill(answersShort['key-file']),
    none: uploadMessages.answersPill(answersShort.none),
  } as const
}

/** The hatched marker: the whole job happens on this one screen. */
function InplaceHint() {
  return (
    <div className="ds-inplace">
      <svg
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />
      </svg>
      <p>
        {convertMessages.inplaceBefore}
        <strong>{convertMessages.inplaceHighlight}</strong>
        {convertMessages.inplaceAfter}
      </p>
    </div>
  )
}

/**
 * The real Convert tab: home, files, running, and done stages. Progress is
 * read from the persisted run state, so a reload mid-run redraws the same
 * bars and the executor picks up where it left off.
 */
export interface ConvertProps {
  onRequestApiKey: () => void
}

export function Convert({ onRequestApiKey }: ConvertProps) {
  const { job, updateJob } = useCurrentJob()
  const pdfs = useJobPdfs(CURRENT_JOB_ID)
  const conversion = useConversion(CURRENT_JOB_ID)
  const [notes, setNotes] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [reviewRunId, setReviewRunId] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const credential = useGeminiCredential()

  if (job === undefined || pdfs === undefined) return null

  const exams = pdfs.filter((file) => file.kind === 'exam')
  const answerKey = pdfs.find((file) => file.kind === 'answer-key')
  const batchSource = job.batchAnswerSource ?? 'inside'
  const keepOriginal = job.keepOriginal ?? true
  const totalPages = exams.reduce((sum, file) => sum + file.pageCount, 0)
  const needsKeyFile = needsAnswerKeyFile(batchSource, exams)
  const keyFileMissing = needsKeyFile && answerKey === undefined
  const keyReady = credential?.lastValidation?.status === 'working'

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

  const startConversion = () => {
    if (!keyReady) {
      onRequestApiKey()
      return
    }
    void conversion.start(exams, batchSource)
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

  const rejectFiles = (files: File[]) => {
    setNotes(files.map((file) => uploadMessages.notPdf(file.name)))
  }

  const inlineNotes = (
    <>
      {busy ? (
        <p className="ds-muted" role="status">
          {convertMessages.readingPdf}
        </p>
      ) : null}
      {notes.map((note) => (
        <p
          className="ds-inline-note ds-inline-note--danger"
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
        className="ds-convert"
        ref={sectionRef}
        tabIndex={-1}
      >
        <header className="ds-work__head">
          <h1 id="convert-heading">{convertMessages.title}</h1>
          <p>{convertMessages.subtitle}</p>
        </header>
        {running ? (
          <RunningStage
            onStop={() => void conversion.stop()}
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
    <section aria-labelledby="convert-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="convert-heading">{convertMessages.title}</h1>
        <p>{convertMessages.subtitle}</p>
      </header>
      {exams.length === 0 ? (
        <div className="ds-stack">
          <FileDropZone
            chooseLabel={uploadMessages.chooseFiles}
            description={convertMessages.dropHint}
            isDisabled={busy}
            label={convertMessages.dropTitle}
            onFiles={(files) => void intake(files, 'exam')}
            onRejected={rejectFiles}
          />
          {inlineNotes}
          <InplaceHint />
        </div>
      ) : (
        <div className="ds-stack">
          <GlassPanel aria-label={convertMessages.batchPanelLabel} as="section" padding="compact">
            <div className="ds-panel-head">
              <strong>{convertMessages.filesReady(exams.length)}</strong>
              <span>{convertMessages.batchOverrideHint}</span>
            </div>
            {inlineNotes}
            <div className="ds-row-list" role="list">
              {exams.map((file) => (
                <FileRow
                  answerSource={file.answerSource}
                  answerSourceLabel={uploadMessages.answerSourceLabel}
                  answerSourceOptionLabels={fileAnswerSourceLabels}
                  answerSourceValueLabels={answersPillLabels(batchSource)}
                  flagLabel={uploadMessages.flagLabel}
                  isDisabled={busy}
                  key={file.id}
                  name={file.name}
                  onAnswerSourceChange={(source) =>
                    void setPdfAnswerSource(file.id, source)
                  }
                  onRemove={() => void removeStoredPdf(file.id)}
                  pageCountLabel={uploadMessages.pageCount(file.pageCount)}
                  removeLabel={uploadMessages.removeFile(file.name)}
                  role="listitem"
                  size={file.size}
                />
              ))}
            </div>
            <div className="ds-drop-more">
              <FileDropZone
                chooseLabel={uploadMessages.chooseFiles}
                description={convertMessages.dropMoreHint}
                isDisabled={busy}
                label={convertMessages.dropMoreTitle}
                onFiles={(files) => void intake(files, 'exam')}
                onRejected={rejectFiles}
              />
            </div>
            <div className="ds-clear-row">
              <Button
                onPress={() => void clearJobPdfs(CURRENT_JOB_ID)}
                variant="quiet"
              >
                {convertMessages.clearAll}
              </Button>
            </div>
          </GlassPanel>

          <GlassPanel aria-label={convertMessages.optionsPanelLabel} as="section" padding="default">
            <div className="ds-field-stack">
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
                <div className="ds-key-file-slot">
                  <p className="ds-inline-note ds-inline-note--info">
                    {uploadMessages.needsKeyFile}
                  </p>
                  {answerKey !== undefined ? (
                    <p className="ds-key-file-added" role="status">
                      ✓ {convertMessages.answerKeyAdded(answerKey.name)}{' '}
                      <Button
                        onPress={() => void removeStoredPdf(answerKey.id)}
                        variant="quiet"
                      >
                        {convertMessages.remove}
                      </Button>
                    </p>
                  ) : (
                    <FileDropZone
                      allowsMultiple={false}
                      chooseLabel={uploadMessages.chooseFiles}
                      description={convertMessages.keyDropHint}
                      isDisabled={busy}
                      label={convertMessages.keyDropTitle}
                      onFiles={(files) => void intake(files, 'answer-key')}
                      onRejected={rejectFiles}
                    />
                  )}
                </div>
              ) : null}
              <Toggle
                description={convertMessages.keepOriginalHint}
                isSelected={keepOriginal}
                label={convertMessages.keepOriginalLabel}
                onChange={(keep) => void updateJob({ keepOriginal: keep })}
              />
            </div>
            <div className="ds-start-row">
              <Button
                isDisabled={busy || keyFileMissing}
                onPress={startConversion}
              >
                {convertMessages.startButton}
              </Button>
              <span className="ds-start-row__note">
                {convertMessages.pagesMinutes(totalPages, estimatedMinutes(totalPages))}
              </span>
            </div>
            {keyFileMissing ? (
              <p className="ds-muted ds-phase-note">
                {uploadMessages.needsKeyFile}
              </p>
            ) : !keyReady ? (
              <p className="ds-muted ds-phase-note">
                {convertMessages.apiKeyRequired}
              </p>
            ) : null}
          </GlassPanel>
          <InplaceHint />
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
  onStop,
  providerStatus,
  runs,
}: {
  onStop: () => void
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
    <div className="ds-stack">
      <GlassPanel aria-label={convertMessages.progressPanelLabel} as="section" padding="default">
        <div className="ds-panel-head">
          <strong>{convertMessages.convertingFiles(runs.length)}</strong>
          <StatusChip status={status} />
        </div>

        <ProgressBar
          label={convertMessages.allPages}
          max={100}
          showFraction={false}
          value={Math.round(batchProgress(runs) * 100)}
        />

        <div className="ds-progress-status" role="status">
          {healthy ? (
            <TypewriterLine sentences={sillySentences} />
          ) : seriousLine !== null ? (
            <p className="ds-inline-note ds-inline-note--info">
              {seriousLine}
            </p>
          ) : null}
          {badPageRun !== undefined ? (
            <p className="ds-inline-note ds-inline-note--info">
              {progressMessages.badPage(
                (badPageRun.badPages?.[0] ?? 0) + 1,
                badPageRun.fileName,
              )}
            </p>
          ) : null}
          {wrongDeclarationRun !== undefined ? (
            <p className="ds-inline-note ds-inline-note--info">
              {progressMessages.wrongDeclaration(wrongDeclarationRun.fileName)}
            </p>
          ) : null}
        </div>

        <div className="ds-row-list" role="list">
          {runs.map((run) => (
            <div className="ds-run-row" key={run.id} role="listitem">
              <ProgressBar
                label={run.fileName}
                max={100}
                showFraction={false}
                value={Math.round(runProgress(run) * 100)}
              />
            </div>
          ))}
        </div>

        <div className="ds-done-actions">
          <Button onPress={onStop} variant="quiet">
            {convertMessages.stopButton}
          </Button>
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
      ? convertMessages.stoppedHeading
      : remaining > 0
        ? progressMessages.finishedWithFlags(remaining)
        : hadFlags
          ? reviewMessages.allResolved
          : progressMessages.finishedClean

  return (
    <div className="ds-stack">
      <GlassPanel aria-label={convertMessages.finishedPanelLabel} as="section" padding="spacious">
        <h2>{heading}</h2>

        {stopped.map((run) => (
          <p
            className="ds-inline-note ds-inline-note--danger"
            key={run.id}
            role="status"
          >
            {convertMessages.stoppedRun(run.fileName, run.stopReason ?? '')}
          </p>
        ))}

        {unsafe.length > 0 ? (
          <p className="ds-inline-note ds-inline-note--info" role="status">
            {convertMessages.unsafeRuns(unsafe.length)}
          </p>
        ) : null}

        {remaining > 0 ? (
          <p className="ds-muted">
            {reviewMessages.flagsRemainOnExport(remaining)}
          </p>
        ) : null}

        {exported ? (
          <p
            className="ds-inline-note ds-inline-note--working"
            role="status"
          >
            {exportMessages.exportDone}
          </p>
        ) : null}

        <div className="ds-done-actions">
          {remaining > 0 && firstFlagged !== undefined ? (
            <>
              <Button onPress={() => onOpenReview(firstFlagged.id)}>
                {convertMessages.reviewFlags(
                  remaining,
                  done.length > 1 ? firstFlagged.fileName : undefined,
                )}
              </Button>
              <Button
                isDisabled={exportBusy || done.length === 0}
                onPress={onExport}
                variant="secondary"
              >
                {exported ? convertMessages.exportAgain : convertMessages.exportAsIs}
              </Button>
            </>
          ) : (
            <Button
              isDisabled={exportBusy || done.length === 0}
              onPress={onExport}
            >
              {exported ? convertMessages.exportAgain : convertMessages.exportBundle}
            </Button>
          )}
          <Button onPress={onConvertAnother} variant="quiet">
            {convertMessages.convertAnother}
          </Button>
          <Badge tone={exported ? 'success' : 'neutral'}>
            {exported ? exportMessages.exported : exportMessages.notExportedYet}
          </Badge>
        </div>
        <p className="ds-muted ds-phase-note">
          {convertMessages.exportDeviceNote} {exportMessages.whyExportMatters}
        </p>

        {import.meta.env.DEV ? (
          <div className="ds-dev-surface">
            <p className="ds-muted">{convertMessages.devGrade}</p>
            {done.map((run) => (
              <div className="ds-dev-row" key={run.id}>
                <Button
                  data-testid={`dev-download-csv-${run.id}`}
                  onPress={() => void downloadRunCsv(run)}
                  variant="quiet"
                >
                  {convertMessages.devDownloadCsv(run.fileName)}
                </Button>
                <span className="ds-muted">
                  {convertMessages.devRunStats(
                    run.requestCount ?? 0,
                    run.totalTokens ?? 0,
                    run.auditUnavailable === true,
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </GlassPanel>
    </div>
  )
}
