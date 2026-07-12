import { useState } from 'react'
import {
  Button,
  FileDropZone,
  FileRow,
  GlassPanel,
  Select,
  Toggle,
} from '../design/components'
import type { SelectOption } from '../design/components'
import { uploadMessages } from '../copy/messages'
import {
  addStoredPdf,
  clearJobPdfs,
  putAnswerKeyPdf,
  removeStoredPdf,
  setPdfAnswerSource,
  useJobPdfs,
} from '../state/files'
import type { AnswerSource } from '../state/types'
import { CURRENT_JOB_ID, useCurrentJob } from '../state/useCurrentJob'
import { estimatedMinutes, needsAnswerKeyFile } from './convert-logic'

const batchSourceOptions: readonly SelectOption<AnswerSource>[] = [
  { id: 'inside', label: 'Inside the PDFs' },
  { id: 'key-file', label: 'In a separate answer key file' },
  { id: 'none', label: 'There are no answers' },
]

/**
 * The real Convert tab, Phase-5 scope: the home and files stages (upload +
 * declaration, persisted). The running/done stages arrive with the engine
 * in Phase 6, which is why Start is disabled.
 */
export function Convert() {
  const { job, updateJob } = useCurrentJob()
  const pdfs = useJobPdfs(CURRENT_JOB_ID)
  const [notes, setNotes] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)

  if (job === undefined || pdfs === undefined) return null

  const exams = pdfs.filter((file) => file.kind === 'exam')
  const answerKey = pdfs.find((file) => file.kind === 'answer-key')
  const batchSource = job.batchAnswerSource ?? 'inside'
  const keepOriginal = job.keepOriginal ?? true
  const totalPages = exams.reduce((sum, file) => sum + file.pageCount, 0)
  const needsKeyFile = needsAnswerKeyFile(batchSource, exams)
  const keyFileMissing = needsKeyFile && answerKey === undefined

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

  return (
    <section aria-labelledby="convert-heading" className="app-tab-screen">
      <h1 id="convert-heading">Convert</h1>
      {exams.length === 0 ? (
        <div className="convert-stack">
          <p>Drop exam PDFs and Codox turns them into Triviadox question sets.</p>
          <GlassPanel aria-label="Start a conversion" as="section" padding="spacious">
            <FileDropZone
              isDisabled={busy}
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
                description="Add more PDFs to this batch"
                isDisabled={busy}
                label="Drop more PDFs here"
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
                      description="PDF answer key"
                      isDisabled={busy}
                      label="Drop the answer key here"
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
              <Button isDisabled onPress={() => undefined}>
                Start converting
              </Button>
            </div>
            {/* Phase-5 scaffolding note, removed when Phase 6 wires the run. */}
            <p className="convert-muted convert-phase-note">
              Converting arrives in the next update. Your PDFs and answer
              declaration are saved on this device
              {keyFileMissing ? ' — the answer key file is still missing' : ''}.
            </p>
          </GlassPanel>
        </div>
      )}
    </section>
  )
}
