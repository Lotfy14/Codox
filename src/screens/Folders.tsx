/**
 * The Folders tab (owner-approved 2026-07-22): a persistent, named collection
 * of exam PDFs. A folder is a `kind: 'folder'` job, so this screen reuses the
 * whole conversion/review/export stack (`useConversion(folderId)`,
 * `useReviewSession`, `ReviewExperience`, the multi-run exporter) — it only
 * adds the folder lifecycle: create/rename/delete, add/remove member PDFs,
 * one shared topic list matched across every PDF (with per-PDF opt-out), and
 * a single Export-all. Nothing here touches the pinned engine path.
 */
import { useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  FileDropZone,
  GlassInput,
  GlassPanel,
  ProgressBar,
  Toggle,
} from '../design/components'
import {
  agentImportMessages,
  appMessages,
  exportMessages,
  folderMessages,
  uploadMessages,
} from '../copy/messages'
import { AgentImport } from './AgentImport'
import { isBatchRunning, runProgress } from '../engine/progress'
import {
  countUnexportedFlagged,
  exportableRuns,
  exportRuns,
  exportToTriviadox,
  triviadoxImportUrl,
  type ExportOutcome,
} from '../export/exporter'
import { ExportButton } from './ExportButton'
import { ReviewExperience } from './ReviewExperience'
import { TopicsEditor } from './TopicsEditor'
import { useConversion } from './useConversion'
import { useReviewSession } from './useReviewSession'
import {
  addStoredPdf,
  answerKeyFor,
  putAnswerKeyPdf,
  useJobPdfs,
} from '../state/files'
import { ExamKeySlot } from './ExamKeySlot'
import { useCustomizationSettings, type ExportTarget } from '../state/customization-settings'
import { useGeminiCredential } from '../state/credentials'
import { useUnresolvedCounts } from './review-data'
import { useJob } from '../state/useCurrentJob'
import {
  createFolder,
  deleteFolder,
  matchFolderTopics,
  removeFolderPdf,
  renameFolder,
  runForPdf,
  setRunTopicExclusion,
  useFolders,
} from '../state/folders'
import type { JobState, RunState, StoredPdf, TopicItem } from '../state/types'

type Note = { text: string; tone: 'info' | 'danger' | 'working' }

export interface FoldersProps {
  onRequestApiKey: () => void
}

export function Folders({ onRequestApiKey }: FoldersProps) {
  const folders = useFolders()
  const [openId, setOpenId] = useState<string | null>(null)

  if (openId !== null) {
    return (
      <FolderDetail
        folderId={openId}
        onBack={() => setOpenId(null)}
        onRequestApiKey={onRequestApiKey}
      />
    )
  }

  return (
    <FolderList
      folders={folders}
      onOpen={setOpenId}
    />
  )
}

// ------------------------------------------------------------------- list

function FolderList({
  folders,
  onOpen,
}: {
  folders: JobState[] | undefined
  onOpen: (id: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const id = await createFolder(name)
      setCreating(false)
      setName('')
      onOpen(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="folders-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="folders-heading">{folderMessages.title}</h1>
      </header>
      <p className="ds-muted">{folderMessages.intro}</p>

      <div className="ds-done-actions">
        <Button onPress={() => setCreating(true)}>{folderMessages.newFolder}</Button>
        <AgentImport onImported={onOpen} />
      </div>
      <p className="ds-muted">{agentImportMessages.hint}</p>

      {folders === undefined ? null : folders.length === 0 ? (
        <GlassPanel as="div" padding="default">
          <div className="ds-empty-state">
            <h2>{folderMessages.emptyTitle}</h2>
            <p>{folderMessages.emptyBody}</p>
          </div>
        </GlassPanel>
      ) : (
        <div className="history-list" role="list">
          {folders.map((folder) => (
            <FolderCard folder={folder} key={folder.id} onOpen={onOpen} />
          ))}
        </div>
      )}

      <Dialog
        actions={(close) => (
          <>
            <Button onPress={close} variant="quiet">
              {folderMessages.cancel}
            </Button>
            <Button isPending={busy} onPress={() => void create()}>
              {folderMessages.create}
            </Button>
          </>
        )}
        dismissLabel={appMessages.dialogDismiss}
        isOpen={creating}
        onOpenChange={(open) => {
          setCreating(open)
          if (!open) setName('')
        }}
        title={folderMessages.newFolderTitle}
      >
        <GlassInput
          label={folderMessages.nameLabel}
          onChange={setName}
          placeholder={folderMessages.namePlaceholder}
          value={name}
        />
      </Dialog>
    </section>
  )
}

/** One folder's summary card — counts read from a lightweight run query. */
function FolderCard({
  folder,
  onOpen,
}: {
  folder: JobState
  onOpen: (id: string) => void
}) {
  const pdfs = useJobPdfs(folder.id)
  const conversion = useConversion(folder.id)
  const runs = conversion.runs ?? []
  const exams = (pdfs ?? []).filter((file) => file.kind === 'exam')
  const doneCount = runs.filter((run) => run.status === 'done').length

  return (
    <GlassPanel as="article" className="history-card" padding="default" role="listitem">
      <div className="history-card__head">
        <div>
          <h2>{folder.name ?? 'Untitled folder'}</h2>
          <p>{folderMessages.pdfCount(exams.length)}</p>
        </div>
        <Badge tone={doneCount > 0 ? 'success' : 'neutral'}>
          {folderMessages.doneCount(doneCount, exams.length)}
        </Badge>
      </div>
      <div className="history-card__actions">
        <Button onPress={() => onOpen(folder.id)}>{folderMessages.open}</Button>
      </div>
    </GlassPanel>
  )
}

// ----------------------------------------------------------------- detail

function FolderDetail({
  folderId,
  onBack,
  onRequestApiKey,
}: {
  folderId: string
  onBack: () => void
  onRequestApiKey: () => void
}) {
  const { job, updateJob } = useJob(folderId)
  const pdfs = useJobPdfs(folderId)
  const conversion = useConversion(folderId)
  const settings = useCustomizationSettings()
  const credential = useGeminiCredential()
  const runs = conversion.runs ?? []
  const reviewSession = useReviewSession(runs)

  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<readonly string[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [matchProgress, setMatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportPrompt, setExportPrompt] = useState<{ target: ExportTarget; count: number } | null>(null)

  if (job === undefined || pdfs === undefined || settings === undefined) return null

  const exams = pdfs.filter((file) => file.kind === 'exam')
  const doneRuns = runs.filter((run) => run.status === 'done')
  const keyReady = credential?.lastValidation?.status === 'working'
  const running = isBatchRunning(runs) || conversion.isDriving
  const pendingExams = exams.filter((pdf) => runForPdf(runs, pdf) === undefined)

  // Full-screen review takeover, exactly as Convert/History do it.
  if (reviewSession.view.kind === 'detail') {
    return (
      <section className="ds-convert">
        <ReviewExperience
          onExport={() => void handleExport(settings.exportTarget)}
          runs={runs}
          session={reviewSession}
        />
      </section>
    )
  }

  const intake = async (files: File[]) => {
    setBusy(true)
    const failed: string[] = []
    try {
      const { EncryptedPdfError, readPdfInfo } = await import('../pdf')
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const { pageCount } = await readPdfInfo(bytes)
          await addStoredPdf({
            jobId: folderId,
            kind: 'exam',
            name: file.name,
            size: file.size,
            pageCount,
            blob: file as Blob,
          })
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

  const addKey = async (parentPdfId: string, files: File[]) => {
    setBusy(true)
    const failed: string[] = []
    try {
      const { isImageMime, readPdfInfo } = await import('../pdf')
      for (const file of files) {
        try {
          const isImage = isImageMime(file.type)
          const bytes = new Uint8Array(await file.arrayBuffer())
          const pageCount = isImage ? 1 : (await readPdfInfo(bytes)).pageCount
          await putAnswerKeyPdf(
            {
              jobId: folderId,
              name: file.name,
              size: file.size,
              pageCount,
              blob: file as Blob,
            },
            parentPdfId,
          )
        } catch {
          failed.push(uploadMessages.notPdfOrImage(file.name))
        }
      }
    } finally {
      setNotes(failed)
      setBusy(false)
    }
  }

  const convert = async (targets: readonly StoredPdf[]) => {
    if (targets.length === 0) return
    if (!keyReady) {
      onRequestApiKey()
      return
    }
    try {
      await conversion.start(targets)
    } catch {
      setNote({ text: folderMessages.convertFailed, tone: 'danger' })
    }
  }

  const matchTopics = async () => {
    const topics = job.topics ?? []
    if (topics.length === 0) {
      setNote({ text: folderMessages.matchNoTopics, tone: 'info' })
      return
    }
    if (doneRuns.length === 0) {
      setNote({ text: folderMessages.matchNoRuns, tone: 'info' })
      return
    }
    if (!keyReady) {
      onRequestApiKey()
      return
    }
    setNote(null)
    setMatchProgress({ done: 0, total: doneRuns.length })
    try {
      const outcome = await matchFolderTopics(folderId, {
        onProgress: (done, total) => setMatchProgress({ done, total }),
      })
      if (outcome.failure === 'wrong-key') {
        setNote({ text: folderMessages.matchWrongKey, tone: 'danger' })
      } else if (outcome.failure !== undefined) {
        setNote({ text: folderMessages.matchFailed, tone: 'danger' })
      } else {
        setNote({ text: folderMessages.matchDone(outcome.matched), tone: 'info' })
      }
    } catch {
      setNote({ text: folderMessages.matchFailed, tone: 'danger' })
    } finally {
      setMatchProgress(null)
    }
  }

  async function handleExport(target: ExportTarget) {
    if (exportBusy || exportPrompt !== null) return
    const heldBack = await countUnexportedFlagged(runs)
    if (heldBack > 0) {
      setExportPrompt({ target, count: heldBack })
      return
    }
    await performExport(target)
  }

  async function performExport(target: ExportTarget) {
    if (exportBusy) return
    setExportBusy(true)
    setNote(null)
    try {
      if (target === 'triviadox') {
        const res = await exportToTriviadox(runs)
        if (res.success && res.id) {
          window.open(triviadoxImportUrl(res.id), '_blank')
          setNote({ text: exportMessages.triviadoxDone, tone: 'working' })
        } else {
          setNote({
            text: res.error === 'nothing' ? folderMessages.exportNothing : folderMessages.exportFailed,
            tone: res.error === 'nothing' ? 'info' : 'danger',
          })
        }
      } else {
        const outcome: ExportOutcome = await exportRuns(runs)
        setNote({
          text:
            outcome === 'cancelled'
              ? folderMessages.exportCancelled
              : outcome === 'nothing'
                ? folderMessages.exportNothing
                : outcome === 'downloaded'
                  ? folderMessages.exportDownloaded
                  : folderMessages.exportComplete,
          tone: outcome === 'cancelled' || outcome === 'nothing' ? 'info' : 'working',
        })
      }
    } catch {
      setNote({ text: folderMessages.exportFailed, tone: 'danger' })
    } finally {
      setExportBusy(false)
    }
  }

  const canExport = exportableRuns(runs).length > 0

  return (
    <section aria-labelledby="folder-heading" className="ds-convert">
      <header className="ds-work__head">
        <Button onPress={onBack} variant="quiet">
          {folderMessages.back}
        </Button>
        <h1 id="folder-heading">{job.name ?? 'Untitled folder'}</h1>
      </header>

      {note !== null ? (
        <p className={`ds-inline-note ds-inline-note--${note.tone}`} role="status">
          {note.text}
        </p>
      ) : null}
      {notes.map((n) => (
        <p className="ds-inline-note ds-inline-note--danger" key={n} role="status">
          {n}
        </p>
      ))}

      <div className="ds-stack ds-upload-layout">
        <GlassPanel as="section" className="ds-upload-panel ds-upload-panel--files" padding="compact">
          <div className="ds-panel-head">
            <strong>{folderMessages.filesHeading}</strong>
          </div>
          <div className="ds-row-list" role="list">
            {exams.map((pdf) => (
              <FolderPdfRow
                busy={busy}
                key={pdf.id}
                keyFile={answerKeyFor(pdfs, pdf.id)}
                onAddKey={(files) => void addKey(pdf.id, files)}
                onConvert={() => void convert([pdf])}
                onExcludeChange={(excluded) => {
                  const run = runForPdf(runs, pdf)
                  if (run !== undefined) void setRunTopicExclusion(run.id, excluded)
                }}
                onRejectKey={(files) =>
                  setNotes(files.map((f) => uploadMessages.notPdfOrImage(f.name)))
                }
                onRemove={() => void removeFolderPdf(pdf.id)}
                onRemoveKey={() => {
                  const key = answerKeyFor(pdfs, pdf.id)
                  if (key !== undefined) void removeFolderPdf(key.id)
                }}
                onReview={(runId) => reviewSession.openNeedsReview(runId)}
                pdf={pdf}
                run={runForPdf(runs, pdf)}
              />
            ))}
          </div>
          <div className="ds-drop-more">
            <FileDropZone
              chooseLabel={uploadMessages.chooseFiles}
              description={folderMessages.dropHint}
              isDisabled={busy}
              label={exams.length === 0 ? folderMessages.dropTitle : folderMessages.dropMoreTitle}
              onFiles={(files) => void intake(files)}
              onRejected={(files) => setNotes(files.map((f) => uploadMessages.notPdf(f.name)))}
            />
          </div>
          {/* Exams an agent already extracted come in here rather than
              through the PDF zone: they arrive finished, not queued. */}
          <div className="ds-done-actions">
            <AgentImport folderId={folderId} variant="quiet" />
          </div>
        </GlassPanel>

        <GlassPanel as="section" className="ds-upload-panel ds-upload-panel--options" padding="compact">
          <div className="ds-options-stack">
            <div className="ds-key-file-slot">
              <strong>{folderMessages.topicsHeading}</strong>
              <p className="ds-muted">{folderMessages.topicsHint}</p>
              <TopicsEditor
                isDisabled={matchProgress !== null}
                onCommit={(topics: TopicItem[]) => void updateJob({ topics })}
                topics={job.topics ?? []}
              />
              <Button
                isDisabled={matchProgress !== null}
                onPress={() => void matchTopics()}
                variant="secondary"
              >
                {folderMessages.matchAll}
              </Button>
              {matchProgress !== null ? (
                <p className="ds-inline-note ds-inline-note--working" role="status">
                  {matchProgress.done === 0 && matchProgress.total === 0
                    ? folderMessages.matching
                    : folderMessages.matchProgress(matchProgress.done, matchProgress.total)}
                </p>
              ) : null}
            </div>
            <div className="ds-key-file-slot">
              <RenameField initial={job.name ?? ''} onSave={(name) => void renameFolder(folderId, name)} />
            </div>
          </div>
        </GlassPanel>

        <div className="ds-convert-action ds-done-actions">
          <Button
            isDisabled={pendingExams.length === 0 || running}
            onPress={() => void convert(pendingExams)}
          >
            {folderMessages.convertAll}
          </Button>
          <ExportButton
            isDisabled={!canExport}
            isPending={exportBusy}
            onPress={() => void handleExport(settings.exportTarget)}
            target={settings.exportTarget}
            variant={canExport ? 'primary' : 'secondary'}
          />
          <Button onPress={() => setConfirmDelete(true)} variant="quiet">
            {folderMessages.delete}
          </Button>
        </div>
      </div>

      {doneRuns.length > 0 ? (
        <ReviewExperience
          onExport={() => void handleExport(settings.exportTarget)}
          runs={runs}
          session={reviewSession}
        />
      ) : null}

      <Dialog
        actions={(close) => (
          <>
            <Button onPress={close} variant="quiet">
              {folderMessages.cancel}
            </Button>
            <Button
              onPress={() => {
                close()
                void deleteFolder(folderId).then(onBack)
              }}
              variant="danger"
            >
              {folderMessages.confirmDelete}
            </Button>
          </>
        )}
        dismissLabel={appMessages.dialogDismiss}
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={folderMessages.deleteTitle(job.name ?? '')}
      >
        <p className="ds-muted">{folderMessages.deleteBody}</p>
      </Dialog>

      <Dialog
        description={exportPrompt !== null ? exportMessages.holdbackBody(exportPrompt.count) : ''}
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
                const target = exportPrompt?.target
                close()
                if (target !== undefined) void performExport(target)
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

/** One member PDF: its answer key, conversion status, opt-out, and actions. */
function FolderPdfRow({
  pdf,
  run,
  keyFile,
  busy,
  onConvert,
  onReview,
  onRemove,
  onExcludeChange,
  onAddKey,
  onRemoveKey,
  onRejectKey,
}: {
  pdf: StoredPdf
  run: RunState | undefined
  keyFile: StoredPdf | undefined
  busy: boolean
  onConvert: () => void
  onReview: (runId: string) => void
  onRemove: () => void
  onExcludeChange: (excluded: boolean) => void
  onAddKey: (files: File[]) => void
  onRemoveKey: () => void
  onRejectKey: (files: File[]) => void
}) {
  const counts = useUnresolvedCounts(run?.status === 'done' ? [run.id] : [])
  const unresolved = run === undefined ? 0 : (counts?.[run.id] ?? 0)
  const converting = run?.status === 'running' || run?.status === 'paused'
  const done = run?.status === 'done'
  // A key only feeds conversion, so hide the slot once the PDF has a run.
  const showKeySlot = run === undefined || run.status === 'stopped'

  const statusBadge = () => {
    if (run === undefined) return <Badge tone="neutral">{folderMessages.statusNotConverted}</Badge>
    if (converting) return <Badge tone="primary">{folderMessages.statusConverting}</Badge>
    if (run.status === 'stopped') return <Badge tone="danger">{folderMessages.statusStopped}</Badge>
    if (unresolved > 0) return <Badge tone="warning">{folderMessages.statusNeedsReview(unresolved)}</Badge>
    return <Badge tone="success">{folderMessages.statusReady}</Badge>
  }

  return (
    <GlassPanel as="div" className="history-card" padding="compact" role="listitem">
      <div className="history-card__head">
        <div>
          <strong>{pdf.name}</strong>
          <p>{uploadMessages.pageCount(pdf.pageCount)}</p>
        </div>
        {statusBadge()}
      </div>
      {showKeySlot ? (
        <ExamKeySlot
          isDisabled={busy}
          keyFile={keyFile}
          onAdd={onAddKey}
          onRejected={onRejectKey}
          onRemove={onRemoveKey}
        />
      ) : null}
      {converting ? (
        <ProgressBar
          label={pdf.name}
          max={100}
          showFraction={false}
          value={Math.round(runProgress(run) * 100)}
        />
      ) : null}
      <div className="history-card__actions">
        {run === undefined || run.status === 'stopped' ? (
          <Button onPress={onConvert} variant="secondary">
            {folderMessages.convert}
          </Button>
        ) : null}
        {done ? (
          <Button onPress={() => onReview(run.id)} variant="quiet">
            {folderMessages.review}
          </Button>
        ) : null}
        {done ? (
          <Toggle
            isSelected={run.excludeFromTopicMatch === true}
            label={folderMessages.excludeFromTopics}
            onChange={onExcludeChange}
          />
        ) : null}
        <Button onPress={onRemove} variant="quiet">
          {folderMessages.remove}
        </Button>
      </div>
    </GlassPanel>
  )
}

/** Inline folder-name editor — commits only a non-empty change. */
function RenameField({
  initial,
  onSave,
}: {
  initial: string
  onSave: (name: string) => void
}) {
  const [value, setValue] = useState(initial)
  const dirty = value.trim() !== '' && value.trim() !== initial.trim()
  return (
    <div className="ds-rename-row">
      <GlassInput label={folderMessages.nameLabel} onChange={setValue} value={value} />
      <Button isDisabled={!dirty} onPress={() => onSave(value)} variant="secondary">
        {folderMessages.renameSave}
      </Button>
    </div>
  )
}
