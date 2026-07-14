import { useRef, useState } from 'react'
import {
  Badge,
  Button,
  FileDropZone,
  FileRow,
  GlassInput,
  GlassPanel,
  ProgressBar,
  SplitButton,
  StatusChip,
  Toggle,
} from '../design/components'
import type { FileAccept, StatusChipStatus } from '../design/components'
import {
  convertMessages,
  exportMessages,
  progressMessages,
  reviewMessages,
  topicsMessages,
  uploadMessages,
} from '../copy/messages'
import { isBatchRunning, runProgress } from '../engine/progress'
import {
  exportableRuns,
  exportRuns,
  type ExportMode,
  type ExportOutcome,
} from '../export/exporter'
import { AiExportDialog } from './AiExportDialog'
import {
  addStoredPdf,
  putAnswerKeyPdf,
  putTopicsDoc,
  removeStoredPdf,
  useJobPdfs,
} from '../state/files'
import { useCustomizationSettings } from '../state/customization-settings'
import type { RunState, StoredPdf, TopicItem } from '../state/types'
import { CURRENT_JOB_ID, useCurrentJob } from '../state/useCurrentJob'
import { TopicsEditor } from './TopicsEditor'
import { useConversion } from './useConversion'
import { archiveCurrentJobAndReset, clearCurrentDraft } from '../state/jobs'
import { useUnresolvedCounts } from './review-data'
import { useTopicMatchPending } from './useTopicMatchStatus'
import { ReviewExperience } from './ReviewExperience'
import { useReviewSession } from './useReviewSession'
import type { ControllerStatus } from '../providers/controller'
import { useGeminiCredential } from '../state/credentials'

type ConversionStatus = ControllerStatus

const TOPICS_ACCEPT: FileAccept = {
  mimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  extensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
}

/**
 * The optional year input — local display state (typing never waits on
 * Dexie), every change committed so Start always reads the typed value.
 */
function YearField({
  initial,
  isDisabled,
  onCommit,
}: {
  initial: string
  isDisabled: boolean
  onCommit: (year: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <GlassInput
      description={topicsMessages.yearHint}
      isDisabled={isDisabled}
      label={topicsMessages.yearLabel}
      onChange={(year) => {
        setValue(year)
        onCommit(year.trim())
      }}
      value={value}
    />
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
  const [exportBusy, setExportBusy] = useState(false)
  const [aiExportOpen, setAiExportOpen] = useState(false)
  const [exportNotice, setExportNotice] = useState<{
    text: string
    tone: 'info' | 'danger' | 'working'
  } | null>(null)
  const [startBusy, setStartBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [topicsBusy, setTopicsBusy] = useState(false)
  const [topicsNote, setTopicsNote] = useState<{
    text: string
    tone: 'info' | 'danger'
  } | null>(null)
  // Remounts the editor when an extraction replaces the whole list.
  const [topicsNonce, setTopicsNonce] = useState(0)
  const sectionRef = useRef<HTMLElement | null>(null)
  const credential = useGeminiCredential()
  const settings = useCustomizationSettings()
  const runs = conversion.runs ?? []
  const reviewSession = useReviewSession(runs)

  if (job === undefined || pdfs === undefined || settings === undefined) {
    return null
  }

  const exams = pdfs.filter((file) => file.kind === 'exam')
  const answerKey = pdfs.find((file) => file.kind === 'answer-key')
  const topicsDoc = pdfs.find((file) => file.kind === 'topics')
  const keepOriginal = job.keepOriginal ?? false
  const keyReady = credential?.lastValidation?.status === 'working'

  const hasRuns = runs.length > 0
  const running = isBatchRunning(runs) || conversion.isDriving

  const noticeForOutcome = (outcome: ExportOutcome) => {
    if (outcome === 'cancelled') {
      setExportNotice({ text: exportMessages.cancelled, tone: 'info' })
    } else if (outcome === 'nothing') {
      setExportNotice({ text: exportMessages.nothingToExport, tone: 'info' })
    } else if (outcome === 'downloaded') {
      // No save dialog appeared — say where the browser put the zip.
      setExportNotice({ text: exportMessages.downloadedToFolder, tone: 'info' })
    }
  }

  const handleExport = async (mode: ExportMode = 'with-answers') => {
    if (exportBusy) return
    setExportBusy(true)
    setExportNotice(null)
    try {
      noticeForOutcome(await exportRuns(runs, { mode }))
    } catch {
      setExportNotice({ text: exportMessages.failed, tone: 'danger' })
    } finally {
      setExportBusy(false)
    }
  }

  const startConversion = async () => {
    if (startBusy) return
    if (!keyReady) {
      onRequestApiKey()
      return
    }
    setStartBusy(true)
    try {
      await conversion.start(exams, answerKey)
    } catch {
      setNotes([convertMessages.startFailed])
    } finally {
      setStartBusy(false)
    }
  }

  const startFreshConversion = async () => {
    if (resetBusy) return
    setResetBusy(true)
    try {
      await archiveCurrentJobAndReset()
    } finally {
      setResetBusy(false)
    }
  }

  /**
   * Reads the topics document with Gemini and fills the editor. Quota and
   * offline pauses are absorbed by the controller (the status line under
   * the drop zone explains the wait); only a rejected key or a document
   * with no readable list ends the attempt.
   */
  const readTopicsDoc = async (doc: Pick<StoredPdf, 'name' | 'blob'>) => {
    if (topicsBusy) return
    setTopicsBusy(true)
    setTopicsNote(null)
    try {
      const { extractTopicsFromDocument } = await import(
        '../engine/topic-extract'
      )
      const bytes = new Uint8Array(await doc.blob.arrayBuffer())
      const mimeType =
        doc.blob.type === '' ? 'application/pdf' : doc.blob.type
      const outcome = await extractTopicsFromDocument({ bytes, mimeType })
      if (outcome.ok) {
        await updateJob({ topics: outcome.topics })
        setTopicsNonce((nonce) => nonce + 1)
        setTopicsNote(
          outcome.topics.length > 0
            ? { text: topicsMessages.readSuccess(doc.name), tone: 'info' }
            : { text: topicsMessages.readUnreadable, tone: 'info' },
        )
      } else if ('invalid' in outcome) {
        setTopicsNote({ text: topicsMessages.readUnreadable, tone: 'info' })
      } else if (outcome.failure.kind !== 'aborted') {
        setTopicsNote({
          text:
            outcome.failure.kind === 'wrong-key'
              ? topicsMessages.readWrongKey
              : topicsMessages.readFailed,
          tone: 'danger',
        })
      }
    } catch {
      setTopicsNote({ text: topicsMessages.readUnreadable, tone: 'info' })
    } finally {
      setTopicsBusy(false)
    }
  }

  const intake = async (
    files: File[],
    kind: 'exam' | 'answer-key' | 'topics',
  ) => {
    setBusy(true)
    const failed: string[] = []
    let storedTopicsDoc: Pick<StoredPdf, 'name' | 'blob'> | undefined
    try {
      // Loaded on demand so the PDF engine (pdfium WASM + pdf.js) stays
      // out of the app's startup bundle.
      const { EncryptedPdfError, readPdfInfo } = await import('../pdf')
      const { isTopicsImage } = await import('../engine/topic-extract')
      for (const file of files) {
        try {
          const isImage = kind === 'topics' && isTopicsImage(file.type)
          // The open check: page count on success, a plain-English note on
          // failure. A file that cannot be opened is never stored. Topics
          // images have no pages to count.
          const bytes = new Uint8Array(await file.arrayBuffer())
          const pageCount = isImage ? 1 : (await readPdfInfo(bytes)).pageCount
          const entry = {
            jobId: CURRENT_JOB_ID,
            name: file.name,
            size: file.size,
            pageCount,
            blob: file as Blob,
          }
          if (kind === 'answer-key') await putAnswerKeyPdf(entry)
          else if (kind === 'topics') {
            await putTopicsDoc(entry)
            storedTopicsDoc = entry
          } else await addStoredPdf({ ...entry, kind: 'exam' })
        } catch (error) {
          failed.push(
            error instanceof EncryptedPdfError
              ? uploadMessages.encryptedPdf(file.name)
              : kind === 'topics'
                ? uploadMessages.notPdfOrImage(file.name)
                : uploadMessages.notPdf(file.name),
          )
        }
      }
    } finally {
      setNotes(failed)
      setBusy(false)
    }
    if (storedTopicsDoc !== undefined) await readTopicsDoc(storedTopicsDoc)
  }

  const rejectFiles = (files: File[]) => {
    setNotes(files.map((file) => uploadMessages.notPdf(file.name)))
  }

  const rejectTopicsFiles = (files: File[]) => {
    setNotes(files.map((file) => uploadMessages.notPdfOrImage(file.name)))
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
        </header>
        {exportNotice !== null ? (
          <p
            className={`ds-inline-note ds-inline-note--${exportNotice.tone}`}
            role="status"
          >
            {exportNotice.text}
          </p>
        ) : null}
        {running ? (
          <RunningStage
            onStop={() => void conversion.stop()}
            providerStatus={conversion.providerStatus}
            runs={runs}
          />
        ) : reviewSession.view.kind === 'detail' ? (
          <ReviewExperience
            onExport={() => void handleExport()}
            runs={runs}
            session={reviewSession}
          />
        ) : (
          <>
            <DoneStage
              exportBusy={exportBusy}
              exported={exported}
              matching={conversion.isMatching}
              onAiExport={() => setAiExportOpen(true)}
              onConvertAnother={() => void startFreshConversion()}
              onExport={(mode) => void handleExport(mode)}
              onOpenReview={reviewSession.openNeedsReview}
              onRequestApiKey={onRequestApiKey}
              onRetry={(runIds) => void conversion.retry(runIds)}
              onRetryMatching={(runIds) =>
                void conversion.retryTopicMatching(runIds)
              }
              resetBusy={resetBusy}
              runs={runs}
              topicMatchIssue={conversion.topicMatchIssue}
            />
            <ReviewExperience
              onExport={() => void handleExport()}
              runs={runs}
              session={reviewSession}
            />
          </>
        )}
        <AiExportDialog
          isOpen={aiExportOpen}
          onExported={noticeForOutcome}
          onOpenChange={setAiExportOpen}
          runs={runs}
        />
      </section>
    )
  }

  return (
    <section aria-labelledby="convert-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="convert-heading">{convertMessages.title}</h1>
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
        </div>
      ) : (
        <div className="ds-stack ds-upload-layout">
          <GlassPanel
            aria-label={convertMessages.batchPanelLabel}
            as="section"
            className="ds-upload-panel ds-upload-panel--files"
            padding="compact"
          >
            <div className="ds-panel-head">
              <strong>{convertMessages.filesReady(exams.length)}</strong>
              <Button
                onPress={() => void clearCurrentDraft()}
                variant="quiet"
              >
                {convertMessages.clearAll}
              </Button>
            </div>
            {inlineNotes}
            <div className="ds-row-list" role="list">
              {exams.map((file) => (
                <FileRow
                  flagLabel={uploadMessages.flagLabel}
                  isDisabled={busy}
                  key={file.id}
                  name={file.name}
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
          </GlassPanel>

          <GlassPanel
            aria-label={convertMessages.optionsPanelLabel}
            as="section"
            className="ds-upload-panel ds-upload-panel--options"
            padding="compact"
          >
            <div className="ds-options-stack">
              <Toggle
                isSelected={keepOriginal}
                label={convertMessages.keepOriginalLabel}
                onChange={(keep) => void updateJob({ keepOriginal: keep })}
              />
              <div className="ds-key-file-slot">
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
              {settings.yearMode === 'type' ? (
                <YearField
                  initial={job.typedYear ?? ''}
                  isDisabled={busy}
                  onCommit={(typedYear) => void updateJob({ typedYear })}
                />
              ) : null}
              {settings.topicsMode === 'on' ? (
                <div className="ds-key-file-slot">
                  {topicsDoc !== undefined ? (
                    <p className="ds-key-file-added" role="status">
                      ✓ {topicsMessages.docAdded(topicsDoc.name)}{' '}
                      <Button
                        isDisabled={topicsBusy}
                        onPress={() => void readTopicsDoc(topicsDoc)}
                        variant="quiet"
                      >
                        {topicsMessages.readAgain}
                      </Button>{' '}
                      <Button
                        isDisabled={topicsBusy}
                        onPress={() => void removeStoredPdf(topicsDoc.id)}
                        variant="quiet"
                      >
                        {convertMessages.remove}
                      </Button>
                    </p>
                  ) : (
                    <FileDropZone
                      accept={TOPICS_ACCEPT}
                      allowsMultiple={false}
                      chooseLabel={uploadMessages.chooseFiles}
                      description={topicsMessages.dropHint}
                      isDisabled={busy || topicsBusy}
                      label={topicsMessages.dropTitle}
                      onFiles={(files) => void intake(files, 'topics')}
                      onRejected={rejectTopicsFiles}
                    />
                  )}
                  {topicsBusy ? (
                    <p className="ds-muted" role="status">
                      {conversion.providerStatus.kind === 'paused'
                        ? conversion.providerStatus.reason === 'quota'
                          ? topicsMessages.readQuotaPaused
                          : topicsMessages.readUnreachable
                        : topicsMessages.reading}
                    </p>
                  ) : null}
                  {topicsNote !== null ? (
                    <p
                      className={`ds-inline-note ds-inline-note--${topicsNote.tone}`}
                      role="status"
                    >
                      {topicsNote.text}
                    </p>
                  ) : null}
                  <TopicsEditor
                    isDisabled={busy || topicsBusy}
                    key={topicsNonce}
                    onCommit={(topics: TopicItem[]) => void updateJob({ topics })}
                    topics={job.topics ?? []}
                  />
                </div>
              ) : null}
            </div>
          </GlassPanel>

          <div className="ds-convert-action">
            <Button
              isDisabled={busy || startBusy}
              isPending={startBusy}
              onPress={() => void startConversion()}
            >
              {convertMessages.startButton}
            </Button>
          </div>
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
  const badPageRun = runs.find((run) => (run.badPages?.length ?? 0) > 0)

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

        {runs.length === 1 ? (
          <ProgressBar
            label={runs[0].fileName}
            max={100}
            showFraction={false}
            value={Math.round(runProgress(runs[0]) * 100)}
          />
        ) : null}

        <div className="ds-progress-status" role="status">
          {seriousLine !== null ? (
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
        </div>

        {runs.length > 1 ? (
          <div className="ds-run-list" role="list">
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
        ) : null}

        <div className="ds-done-actions">
          <Button onPress={onStop}>
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
/** The variant entries behind the export split button's chevron. */
const exportMenuItems = [
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
] as const

function DoneStage({
  exportBusy,
  exported,
  matching,
  onAiExport,
  onConvertAnother,
  onExport,
  onOpenReview,
  onRequestApiKey,
  onRetry,
  onRetryMatching,
  resetBusy,
  runs,
  topicMatchIssue,
}: {
  exportBusy: boolean
  exported: boolean
  matching: boolean
  onAiExport: () => void
  onConvertAnother: () => void
  onExport: (mode: ExportMode) => void
  onOpenReview: (runId: string) => void
  onRequestApiKey: () => void
  onRetry: (runIds: readonly string[]) => void
  onRetryMatching: (runIds: readonly string[]) => void
  resetBusy: boolean
  runs: readonly RunState[]
  topicMatchIssue: 'wrong-key' | 'failed' | null
}) {
  const stopped = runs.filter((run) => run.status === 'stopped')
  const retryable = stopped.filter((run) =>
    [
      'billing-required',
      'invalid-request',
      'model-unavailable',
      'temporarily-unavailable',
      'provider-error',
      'unexpected_error',
    ].includes(run.stopReason ?? ''),
  )
  const wrongKey = stopped.some((run) => run.stopReason === 'wrong-key')
  const done = runs.filter((run) => run.status === 'done')
  const counts = useUnresolvedCounts(done.map((run) => run.id))
  const matchPending = useTopicMatchPending(runs)
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

        {exported ? (
          <p
            className="ds-inline-note ds-inline-note--working"
            role="status"
          >
            {exportMessages.exportDone}
          </p>
        ) : null}

        {matching ? (
          <p className="ds-muted" role="status">
            {topicsMessages.matching}
          </p>
        ) : (matchPending ?? 0) > 0 ? (
          <p className="ds-inline-note ds-inline-note--info" role="status">
            {topicMatchIssue === 'wrong-key'
              ? topicsMessages.matchWrongKey
              : topicsMessages.matchIncomplete(matchPending ?? 0)}{' '}
            <Button
              onPress={() => onRetryMatching(done.map((run) => run.id))}
              variant="quiet"
            >
              {topicsMessages.retryMatching}
            </Button>
          </p>
        ) : null}

        <div className="ds-done-actions">
          {wrongKey ? (
            <Button onPress={onRequestApiKey} variant="secondary">
              {convertMessages.fixApiKey}
            </Button>
          ) : null}
          {retryable.length > 0 ? (
            <Button
              onPress={() => onRetry(retryable.map((run) => run.id))}
              variant="secondary"
            >
              {convertMessages.retryStopped}
            </Button>
          ) : null}
          {remaining > 0 && firstFlagged !== undefined ? (
            <>
              <Button onPress={() => onOpenReview(firstFlagged.id)}>
                {convertMessages.reviewFlags(
                  remaining,
                  done.length > 1 ? firstFlagged.fileName : undefined,
                )}
              </Button>
              <SplitButton
                isDisabled={exportBusy || done.length === 0}
                items={exportMenuItems}
                menuLabel={exportMessages.menuLabel}
                onAction={(id) =>
                  id === 'ai-answers' ? onAiExport() : onExport('no-answers')
                }
                onPress={() => onExport('with-answers')}
                variant="secondary"
              >
                {exported ? convertMessages.exportAgain : convertMessages.exportAsIs}
              </SplitButton>
            </>
          ) : (
            <SplitButton
              isDisabled={exportBusy || done.length === 0}
              items={exportMenuItems}
              menuLabel={exportMessages.menuLabel}
              onAction={(id) =>
                id === 'ai-answers' ? onAiExport() : onExport('no-answers')
              }
              onPress={() => onExport('with-answers')}
            >
              {exported ? convertMessages.exportAgain : convertMessages.exportBundle}
            </SplitButton>
          )}
          <Button
            isPending={resetBusy}
            loadingLabel={convertMessages.startingFresh}
            onPress={onConvertAnother}
            variant="quiet"
          >
            {convertMessages.convertAnother}
          </Button>
          <Badge tone={exported ? 'success' : 'neutral'}>
            {exported ? exportMessages.exported : exportMessages.notExportedYet}
          </Badge>
        </div>
      </GlassPanel>
    </div>
  )
}
