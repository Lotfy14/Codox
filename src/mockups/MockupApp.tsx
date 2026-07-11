import { useEffect, useState } from 'react'
import { AppShell, Badge, Button, TabNav } from '../design/components'
import type {
  AppTab,
  FileAnswerSource,
  ProviderOrderItem,
} from '../design/components'
import { ConvertMock } from './ConvertMock'
import type { ConvertStage, RunMode } from './ConvertMock'
import { FirstRunMock } from './FirstRunMock'
import { HelpMock } from './HelpMock'
import { HistoryMock } from './HistoryMock'
import { KeysMock } from './KeysMock'
import { ReviewMock } from './ReviewMock'
import { uploadCopy } from './copy'
import { initialProviders, reviewFlags, sampleFiles } from './mockData'
import type { MockFile } from './mockData'
import './mockups.css'

export interface MockupAppProps {
  onExit: () => void
}

function toMockFile(file: File, index: number): MockFile {
  return {
    id: `dropped-${Date.now()}-${index}`,
    name: file.name,
    pages: Math.max(4, Math.round(file.size / 300_000)),
    size: file.size,
  }
}

/**
 * Phase 3 clickable mockups: the five screens composed into the
 * owner-approved dashboard model, running on fake data and local state only.
 * Development-only; nothing here persists or calls a provider.
 */
export function MockupApp({ onExit }: MockupAppProps) {
  const [firstRun, setFirstRun] = useState(true)
  const [activeTab, setActiveTab] = useState<AppTab>('convert')
  const [providers, setProviders] = useState<readonly ProviderOrderItem[]>(
    initialProviders,
  )

  const [stage, setStage] = useState<ConvertStage>('home')
  const [files, setFiles] = useState<readonly MockFile[]>([])
  const [batchSource, setBatchSource] = useState<FileAnswerSource>('inside')
  const [keyFileAdded, setKeyFileAdded] = useState(false)
  const [keepOriginal, setKeepOriginal] = useState(true)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  const [pagesDone, setPagesDone] = useState(0)
  const [runMode, setRunMode] = useState<RunMode>('normal')

  const [resolutions, setResolutions] = useState<Record<string, number>>({})
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewMinimized, setReviewMinimized] = useState(false)
  const [exported, setExported] = useState(false)

  const totalPages = files.reduce((sum, file) => sum + file.pages, 0)
  const flagsLeft =
    reviewFlags.length -
    reviewFlags.filter((flag) => resolutions[flag.id] !== undefined).length

  // The mockup's stand-in for real page-completion events: while "running"
  // and not paused, one page finishes at a calm fixed pace.
  useEffect(() => {
    if (stage !== 'running') return
    if (runMode === 'quota' || runMode === 'offline') return
    const timer = window.setInterval(() => {
      setPagesDone((done) => done + 1)
    }, 900)
    return () => window.clearInterval(timer)
  }, [stage, runMode])

  useEffect(() => {
    if (stage === 'running' && totalPages > 0 && pagesDone >= totalPages) {
      setStage('done')
    }
  }, [stage, pagesDone, totalPages])

  const addFiles = (dropped: File[]) => {
    const accepted = dropped.filter(
      (file) => !file.name.toLowerCase().includes('locked'),
    )
    const rejected = dropped.find((file) =>
      file.name.toLowerCase().includes('locked'),
    )
    setUploadNote(
      rejected === undefined ? null : uploadCopy.encryptedPdf(rejected.name),
    )
    if (accepted.length > 0) {
      setFiles((current) => [...current, ...accepted.map(toMockFile)])
      setStage((current) => (current === 'home' ? 'files' : current))
    }
  }

  const resetConvert = () => {
    setStage('home')
    setFiles([])
    setBatchSource('inside')
    setKeyFileAdded(false)
    setUploadNote(null)
    setPagesDone(0)
    setRunMode('normal')
    setResolutions({})
    setExported(false)
    setReviewMinimized(false)
  }

  const openReview = () => {
    setReviewOpen(true)
    setReviewMinimized(false)
    setActiveTab('convert')
  }

  if (firstRun) {
    return (
      <div className="mockup-root">
        <FirstRunMock onFinish={() => setFirstRun(false)} />
        <div className="mockup-exit">
          <Button onPress={onExit} variant="quiet">
            Exit mockups
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mockup-root">
      <AppShell
        header={
          <div className="mockup-header">
            <span className="mockup-brand">
              <img alt="" height="40" src="/logo.svg" width="40" />
              <span>
                <strong>Codox</strong>
                <small>Exam PDFs → Triviadox</small>
              </span>
            </span>
            <span className="mockup-header__side">
              <Badge tone="primary">Mockup</Badge>
              <Button onPress={onExit} variant="quiet">
                Exit mockups
              </Button>
            </span>
          </div>
        }
        isReviewTakeover={reviewOpen}
        navigation={<TabNav activeTab={activeTab} onTabChange={setActiveTab} />}
        onMinimizeReview={() => {
          setReviewOpen(false)
          setReviewMinimized(true)
        }}
      >
        {reviewOpen ? (
          <ReviewMock
            exported={exported}
            fileName="bio_exam.pdf"
            onExport={() => setExported(true)}
            onFinish={() => {
              setReviewOpen(false)
              setReviewMinimized(false)
              setActiveTab('convert')
            }}
            onResolve={(flagId, optionIndex) =>
              setResolutions((current) => ({
                ...current,
                [flagId]: optionIndex,
              }))
            }
            resolutions={resolutions}
          />
        ) : activeTab === 'convert' ? (
          <ConvertMock
            batchSource={batchSource}
            exported={exported}
            files={files}
            firstProviderName={providers[0]?.name ?? 'Groq'}
            flagsLeft={flagsLeft}
            keepOriginal={keepOriginal}
            keyFileAdded={keyFileAdded}
            onAddSampleFiles={() => {
              setFiles(sampleFiles.map((file) => ({ ...file })))
              setUploadNote(null)
              setStage('files')
            }}
            onBatchSourceChange={setBatchSource}
            onExport={() => setExported(true)}
            onFileSourceChange={(id, source) =>
              setFiles((current) =>
                current.map((file) =>
                  file.id === id ? { ...file, answerSource: source } : file,
                ),
              )
            }
            onFilesDropped={addFiles}
            onKeepOriginalChange={setKeepOriginal}
            onKeyFileAdded={() => setKeyFileAdded(true)}
            onOpenReview={openReview}
            onRemoveFile={(id) =>
              setFiles((current) => {
                const remaining = current.filter((file) => file.id !== id)
                if (remaining.length === 0) setStage('home')
                return remaining
              })
            }
            onReset={resetConvert}
            onRunModeChange={setRunMode}
            onStart={() => {
              setStage('running')
              setPagesDone(0)
              setRunMode('normal')
              setResolutions({})
              setExported(false)
            }}
            pagesDone={pagesDone}
            reviewMinimized={reviewMinimized}
            runMode={runMode}
            secondProviderName={providers[1]?.name ?? 'OpenRouter'}
            stage={stage}
            uploadNote={uploadNote}
          />
        ) : activeTab === 'history' ? (
          <HistoryMock onOpenReview={openReview} />
        ) : activeTab === 'keys' ? (
          <KeysMock
            onProvidersChange={setProviders}
            providers={providers}
          />
        ) : (
          <HelpMock
            onRestartWalkthrough={() => {
              resetConvert()
              setFirstRun(true)
            }}
          />
        )}
      </AppShell>
    </div>
  )
}
