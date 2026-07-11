import {
  Badge,
  Button,
  FileDropZone,
  FileRow,
  GlassPanel,
  ProgressBar,
  ResumeCard,
  Select,
  StatusChip,
  Toggle,
  TypewriterLine,
} from '../design/components'
import type { FileAnswerSource, SelectOption } from '../design/components'
import { sillySentences } from '../design/silly-sentences'
import { exportCopy, progressCopy, reviewCopy, uploadCopy } from './copy'
import { recentRuns } from './mockData'
import type { MockFile } from './mockData'

export type ConvertStage = 'home' | 'files' | 'running' | 'done'

export type RunMode =
  | 'bad-page'
  | 'normal'
  | 'offline'
  | 'quota'
  | 'switch'
  | 'wrong-declaration'

const batchSourceOptions: readonly SelectOption<FileAnswerSource>[] = [
  { id: 'inside', label: 'Inside the PDFs' },
  { id: 'key-file', label: 'In a separate answer key file' },
  { id: 'none', label: 'There are no answers' },
]

const runModeControls: readonly { label: string; mode: RunMode }[] = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'quota', label: 'Quota pause' },
  { mode: 'offline', label: 'Connection drop' },
  { mode: 'switch', label: 'Provider switch' },
  { mode: 'bad-page', label: 'One bad page' },
  { mode: 'wrong-declaration', label: 'Wrong declaration' },
]

export interface ConvertMockProps {
  batchSource: FileAnswerSource
  exported: boolean
  files: readonly MockFile[]
  firstProviderName: string
  flagsLeft: number
  keepOriginal: boolean
  keyFileAdded: boolean
  onAddSampleFiles: () => void
  onBatchSourceChange: (source: FileAnswerSource) => void
  onExport: () => void
  onFileSourceChange: (id: string, source: FileAnswerSource | undefined) => void
  onFilesDropped: (dropped: File[]) => void
  onKeepOriginalChange: (keep: boolean) => void
  onKeyFileAdded: () => void
  onOpenReview: () => void
  onRemoveFile: (id: string) => void
  onReset: () => void
  onRunModeChange: (mode: RunMode) => void
  onStart: () => void
  pagesDone: number
  reviewMinimized: boolean
  runMode: RunMode
  secondProviderName: string
  stage: ConvertStage
  uploadNote: string | null
}

function fileProgress(
  files: readonly MockFile[],
  index: number,
  pagesDone: number,
) {
  const pagesBefore = files
    .slice(0, index)
    .reduce((sum, file) => sum + file.pages, 0)
  const doneInFile = Math.min(
    files[index].pages,
    Math.max(0, pagesDone - pagesBefore),
  )
  return doneInFile
}

/** The Convert tab across all four stages of a run. */
export function ConvertMock(props: ConvertMockProps) {
  const totalPages = props.files.reduce((sum, file) => sum + file.pages, 0)
  const needsKeyFile =
    (props.batchSource === 'key-file' &&
      props.files.some((file) => file.answerSource === undefined)) ||
    props.files.some((file) => file.answerSource === 'key-file')
  const keyFileMissing = needsKeyFile && !props.keyFileAdded

  return (
    <section aria-labelledby="mock-convert-heading" className="mock-screen">
      <header className="mock-screen__header">
        <h1 id="mock-convert-heading">Convert</h1>
        {props.stage === 'home' ? (
          <p>Drop exam PDFs and Codox turns them into Triviadox question sets.</p>
        ) : null}
      </header>

      {props.stage === 'home' ? (
        <HomeStage {...props} />
      ) : props.stage === 'files' ? (
        <div className="mock-stack">
          <GlassPanel as="section" aria-label="Batch files" padding="compact">
            <div className="mock-list-header">
              <strong>
                {props.files.length} PDF{props.files.length === 1 ? '' : 's'} ready
              </strong>
              <Button onPress={props.onReset} variant="quiet">
                Clear
              </Button>
            </div>
            {props.uploadNote !== null ? (
              <p className="mock-inline-note mock-inline-note--wrong-key" role="status">
                {props.uploadNote}
              </p>
            ) : null}
            <div className="mock-row-list" role="list">
              {props.files.map((file) => (
                <FileRow
                  answerSource={file.answerSource}
                  key={file.id}
                  name={file.name}
                  onAnswerSourceChange={(source) =>
                    props.onFileSourceChange(file.id, source)
                  }
                  onRemove={() => props.onRemoveFile(file.id)}
                  role="listitem"
                  size={file.size}
                />
              ))}
            </div>
            <div className="mock-drop-more">
              <FileDropZone
                description="Add more PDFs to this batch"
                label="Drop more PDFs here"
                onFiles={props.onFilesDropped}
              />
            </div>
          </GlassPanel>

          <GlassPanel as="section" aria-label="Before you start" padding="default">
            <div className="mock-field-stack">
              <Select
                description={uploadCopy.declarationHelp}
                label={uploadCopy.declarationQuestion}
                onChange={(source) => {
                  if (source !== null) props.onBatchSourceChange(source)
                }}
                options={batchSourceOptions}
                value={props.batchSource}
              />
              {needsKeyFile ? (
                <div className="mock-key-file-slot">
                  <p className="mock-inline-note mock-inline-note--info">
                    {uploadCopy.needsKeyFile}
                  </p>
                  {props.keyFileAdded ? (
                    <p className="mock-key-file-added" role="status">
                      ✓ answer_key.pdf added
                    </p>
                  ) : (
                    <FileDropZone
                      allowsMultiple={false}
                      description="PDF answer key"
                      label="Drop the answer key here"
                      onFiles={() => props.onKeyFileAdded()}
                    />
                  )}
                </div>
              ) : null}
              <Toggle
                description={uploadCopy.keepOriginalHelp}
                isSelected={props.keepOriginal}
                label="Keep original PDF"
                onChange={props.onKeepOriginalChange}
              />
            </div>
            <div className="mock-start-row">
              <Button isDisabled={keyFileMissing} onPress={props.onStart}>
                Start converting
              </Button>
            </div>
          </GlassPanel>
        </div>
      ) : props.stage === 'running' ? (
        <RunningStage {...props} totalPages={totalPages} />
      ) : (
        <DoneStage {...props} />
      )}
    </section>
  )
}

function HomeStage(props: ConvertMockProps) {
  return (
    <div className="mock-stack">
      {props.reviewMinimized ? (
        <ResumeCard
          fileName="bio_exam"
          flagsLeft={props.flagsLeft}
          onContinue={props.onOpenReview}
        />
      ) : null}

      <GlassPanel as="section" aria-label="Start a conversion" padding="spacious">
        <FileDropZone onFiles={props.onFilesDropped} />
        <div className="mock-sample-row">
          <Button onPress={props.onAddSampleFiles} variant="secondary">
            Add sample PDFs (mockup)
          </Button>
        </div>
        {props.uploadNote !== null ? (
          <p className="mock-inline-note mock-inline-note--wrong-key" role="status">
            {props.uploadNote}
          </p>
        ) : null}
      </GlassPanel>

      <GlassPanel as="section" aria-labelledby="mock-last-runs-heading" padding="compact">
        <div className="mock-list-header">
          <h2 className="mock-panel-heading" id="mock-last-runs-heading">
            Last runs
          </h2>
        </div>
        <div className="mock-row-list" role="list">
          {recentRuns.map((run) => (
            <div className="mock-run-row" key={run.id} role="listitem">
              <div className="mock-run-row__text">
                <strong>{run.name}</strong>
                <span className="mock-run-row__meta">
                  {run.date} · {run.questions} questions
                </span>
              </div>
              <div className="mock-run-row__badges">
                {run.flagsLeft > 0 ? (
                  <Badge tone="warning">{run.flagsLeft} flags left</Badge>
                ) : null}
                <Badge tone={run.exported ? 'success' : 'neutral'}>
                  {run.exported ? exportCopy.exported : exportCopy.notExportedYet}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  )
}

function RunningStage(props: ConvertMockProps & { totalPages: number }) {
  const paused = props.runMode === 'quota' || props.runMode === 'offline'
  return (
    <div className="mock-stack">
      <GlassPanel as="section" aria-label="Conversion progress" padding="default">
        <div className="mock-progress-header">
          <strong>
            Converting {props.files.length} PDF
            {props.files.length === 1 ? '' : 's'}
          </strong>
          <StatusChip
            status={
              props.runMode === 'quota'
                ? 'quota-paused'
                : props.runMode === 'offline'
                  ? 'unreachable'
                  : 'working'
            }
          >
            {props.runMode === 'offline' ? 'Offline' : undefined}
          </StatusChip>
        </div>

        <ProgressBar
          label="All pages"
          max={props.totalPages}
          value={props.pagesDone}
        />

        <div className="mock-progress-status" role="status">
          {props.runMode === 'normal' ? (
            <TypewriterLine sentences={sillySentences} />
          ) : (
            <p
              className={`mock-serious-line ${
                paused ? 'mock-serious-line--calm' : ''
              }`}
            >
              {props.runMode === 'quota'
                ? progressCopy.pausedQuota
                : props.runMode === 'offline'
                  ? progressCopy.offline
                  : props.runMode === 'switch'
                    ? progressCopy.providerSwitch(
                        props.firstProviderName,
                        props.secondProviderName,
                      )
                    : props.runMode === 'bad-page'
                      ? progressCopy.badPage(7, props.files[0]?.name ?? 'bio_exam.pdf')
                      : progressCopy.wrongDeclaration(
                          props.files[1]?.name ?? 'maths_mock.pdf',
                        )}
            </p>
          )}
        </div>

        <div className="mock-row-list mock-file-progress" role="list">
          {props.files.map((file, index) => (
            <div className="mock-run-row" key={file.id} role="listitem">
              <div className="mock-run-row__text mock-run-row__text--grow">
                <ProgressBar
                  label={file.name}
                  max={file.pages}
                  value={fileProgress(props.files, index, props.pagesDone)}
                />
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>

      <MockControls
        active={props.runMode}
        onSelect={props.onRunModeChange}
        title="Mockup controls — preview a running state"
      />
    </div>
  )
}

function DoneStage(props: ConvertMockProps) {
  const allResolved = props.flagsLeft === 0
  return (
    <div className="mock-stack">
      <GlassPanel as="section" aria-label="Conversion finished" padding="spacious">
        <p className="mock-done-mark" aria-hidden="true">
          ✓
        </p>
        <h2 className="mock-panel-heading">
          {allResolved
            ? progressCopy.finishedClean
            : progressCopy.finishedWithFlags(props.flagsLeft)}
        </h2>
        {!allResolved ? (
          <p className="mock-muted">{reviewCopy.flagsRemainOnExport(props.flagsLeft)}</p>
        ) : null}
        {props.exported ? (
          <p className="mock-inline-note mock-inline-note--working" role="status">
            {exportCopy.exportDone}
          </p>
        ) : null}
        <div className="mock-done-actions">
          {allResolved ? (
            <>
              <Button isDisabled={props.exported} onPress={props.onExport}>
                {props.exported ? 'Exported' : 'Export bundle'}
              </Button>
              <Button onPress={props.onReset} variant="quiet">
                Convert another
              </Button>
            </>
          ) : (
            <>
              <Button onPress={props.onOpenReview}>
                Review {props.flagsLeft} flag{props.flagsLeft === 1 ? '' : 's'}
              </Button>
              <Button isDisabled={props.exported} onPress={props.onExport} variant="secondary">
                {props.exported ? 'Exported' : 'Export as-is'}
              </Button>
            </>
          )}
          <Badge tone={props.exported ? 'success' : 'neutral'}>
            {props.exported ? exportCopy.exported : exportCopy.notExportedYet}
          </Badge>
        </div>
        <p className="mock-muted mock-share-note">
          On a phone this opens the share sheet; on desktop it downloads a zip.
        </p>
      </GlassPanel>
    </div>
  )
}

export interface MockControlsProps {
  active: RunMode
  onSelect: (mode: RunMode) => void
  title: string
}

/** Clearly-labelled prototype-only switches for previewing states. */
function MockControls({ active, onSelect, title }: MockControlsProps) {
  return (
    <section aria-label={title} className="mock-controls">
      <p className="mock-controls__title">{title}</p>
      <div className="mock-controls__buttons">
        {runModeControls.map((control) => (
          <Button
            key={control.mode}
            onPress={() => onSelect(control.mode)}
            variant={active === control.mode ? 'secondary' : 'quiet'}
          >
            {control.label}
          </Button>
        ))}
      </div>
    </section>
  )
}
