/**
 * "Import agent folder" — the app end of the agent-conversion workflow.
 *
 * The tutor picks the folder an agent wrote (`agent-conversion/output/…`) and
 * every exam in it becomes a finished run in a Codox folder, so Review, edit
 * mode, topic matching, and export all work on it unchanged. No network call
 * is made: this is a file read, start to finish.
 *
 * Directory picking is a browser capability, not a platform: the button
 * feature-detects `webkitdirectory` and says so plainly when it is missing,
 * rather than opening a picker that returns nothing.
 */
import { useState } from 'react'
import { FileTrigger } from 'react-aria-components/FileTrigger'
import { Button, Dialog, type ButtonVariant } from '../design/components'
import { agentImportMessages, appMessages } from '../copy/messages'
import {
  canPickDirectory,
  importAgentBundle,
  type ImportSummary,
} from '../agent-import/import'
import { createFolder } from '../state/folders'

export interface AgentImportProps {
  /** Import into this folder; omit to create one named after the pick. */
  folderId?: string
  /** Called with the folder the exams landed in, once the tutor dismisses. */
  onImported?: (folderId: string) => void
  variant?: ButtonVariant
}

/** The picked directory's own name — what the new folder gets called. */
function pickedRootName(files: readonly File[]): string {
  for (const file of files) {
    const relative = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath
    const root = relative?.split('/')[0]
    if (root !== undefined && root !== '') return root
  }
  return 'Imported exams'
}

export function AgentImport({
  folderId,
  onImported,
  variant = 'secondary',
}: AgentImportProps) {
  const [progress, setProgress] = useState<string | null>(null)
  const [summary, setSummary] = useState<
    { summary: ImportSummary; folderId: string } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const supported = canPickDirectory()

  const run = async (picked: File[]) => {
    if (picked.length === 0) return
    setError(null)
    setProgress(agentImportMessages.working)
    try {
      const target = folderId ?? (await createFolder(pickedRootName(picked)))
      const result = await importAgentBundle(target, picked, {
        onProgress: (done, total, name) =>
          setProgress(agentImportMessages.progress(done, total, name)),
      })
      setSummary({ summary: result, folderId: target })
    } catch {
      setError(agentImportMessages.failed)
    } finally {
      setProgress(null)
    }
  }

  const found =
    summary === null
      ? 0
      : summary.summary.exams.length + summary.summary.failures.length

  return (
    <>
      {supported ? (
        <FileTrigger
          acceptDirectory
          allowsMultiple
          onSelect={(list) => void run(list === null ? [] : Array.from(list))}
        >
          <Button isPending={progress !== null} variant={variant}>
            {folderId === undefined
              ? agentImportMessages.importFolder
              : agentImportMessages.importIntoFolder}
          </Button>
        </FileTrigger>
      ) : (
        <Button isDisabled title={agentImportMessages.unsupported} variant={variant}>
          {agentImportMessages.importFolder}
        </Button>
      )}

      {!supported ? (
        <p className="ds-inline-note ds-inline-note--info" role="status">
          {agentImportMessages.unsupported}
        </p>
      ) : null}
      {progress !== null ? (
        <p className="ds-inline-note ds-inline-note--working" role="status">
          {progress}
        </p>
      ) : null}
      {error !== null ? (
        <p className="ds-inline-note ds-inline-note--danger" role="status">
          {error}
        </p>
      ) : null}

      <Dialog
        actions={(close) => (
          <Button onPress={close}>{agentImportMessages.done}</Button>
        )}
        dismissLabel={appMessages.dialogDismiss}
        isOpen={summary !== null}
        onOpenChange={(open) => {
          if (open) return
          const target = summary?.folderId
          setSummary(null)
          if (target !== undefined) onImported?.(target)
        }}
        title={agentImportMessages.summaryTitle}
      >
        {summary === null ? null : found === 0 ? (
          <p className="ds-muted">{agentImportMessages.nothingFound}</p>
        ) : (
          <div className="ds-stack">
            {summary.summary.exams.map((exam) => (
              <section key={exam.runId}>
                <strong>
                  {agentImportMessages.examLine(exam.name, exam.questions)}
                </strong>
                <ul className="ds-muted">
                  <li>{agentImportMessages.answersRead(exam.extracted)}</li>
                  {exam.awaitingApproval > 0 ? (
                    <li>
                      {agentImportMessages.answersPending(exam.awaitingApproval)}
                    </li>
                  ) : null}
                  {exam.flagged > 0 ? (
                    <li>{agentImportMessages.answersFlagged(exam.flagged)}</li>
                  ) : null}
                </ul>
                {exam.warnings.length > 0 ? (
                  <details>
                    <summary>{agentImportMessages.warningsTitle}</summary>
                    <ul className="ds-muted">
                      {exam.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {exam.report !== undefined ? (
                  <details>
                    <summary>{agentImportMessages.reportTitle}</summary>
                    <p className="ds-muted ds-prewrap">{exam.report}</p>
                  </details>
                ) : null}
              </section>
            ))}
            {summary.summary.failures.map((failure) => (
              <section key={failure.name}>
                <strong className="ds-inline-note ds-inline-note--danger">
                  {agentImportMessages.failedTitle(failure.name)}
                </strong>
                <ul className="ds-muted">
                  {failure.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Dialog>
    </>
  )
}
