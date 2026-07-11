import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  GlassPanel,
  StorageMeter,
  TabNav,
  ThemeSwitcher,
} from '../design/components'
import type {
  AppTab,
  FileAnswerSource,
  ProviderOrderItem,
  TabNavItem,
} from '../design/components'
import { ConvertMock } from './ConvertMock'
import type { ConvertStage, RunMode } from './ConvertMock'
import { FirstRunMock } from './FirstRunMock'
import { HelpMock } from './HelpMock'
import { HistoryMock } from './HistoryMock'
import { KeysMock } from './KeysMock'
import { ReviewMock } from './ReviewMock'
import { firstRunCopy, keyCopy, uploadCopy } from './copy'
import {
  initialProviders,
  reviewFlags,
  sampleFiles,
  storageUsage,
} from './mockData'
import type { MockFile } from './mockData'
import './mockups.css'

export interface MockupAppProps {
  onExit: () => void
}

const workspaceTabs: readonly TabNavItem[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'history', label: 'History' },
]

function toMockFile(file: File, index: number): MockFile {
  return {
    id: `dropped-${Date.now()}-${index}`,
    name: file.name,
    pages: Math.max(4, Math.round(file.size / 300_000)),
    size: file.size,
  }
}

/**
 * Phase 3 clickable mockups in the one-screen layout: a left workspace
 * sidebar, one center column where the whole Convert job happens in place
 * (drop → options → progress → review → export, no takeover screens), and a
 * right utility rail whose API-keys and Help panels overlay this screen.
 * Development-only; nothing here persists or calls a provider.
 */
export function MockupApp({ onExit }: MockupAppProps) {
  const [firstRun, setFirstRun] = useState(true)
  const [activeTab, setActiveTab] = useState<AppTab>('convert')
  const [providers, setProviders] = useState<readonly ProviderOrderItem[]>(
    initialProviders,
  )
  const [keysOpen, setKeysOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

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

  // Closing the inline review returns focus to the work column, mirroring
  // the focus hand-off the old takeover shell provided.
  const workElement = useRef<HTMLElement | null>(null)
  const previousReviewOpen = useRef(reviewOpen)
  useEffect(() => {
    if (previousReviewOpen.current && !reviewOpen) {
      workElement.current?.focus()
    }
    previousReviewOpen.current = reviewOpen
  }, [reviewOpen])

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

  const minimizeReview = () => {
    setReviewOpen(false)
    setReviewMinimized(true)
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
      <div className="mock-shell">
        <GlassPanel
          as="aside"
          aria-label="Workspace"
          className="mock-shell__side"
          padding="compact"
        >
          <span className="mockup-brand">
            <img alt="" height="40" src="/logo.svg" width="40" />
            <span>
              <strong>Codox</strong>
              <small>Exam PDFs → Triviadox</small>
            </span>
          </span>
          <TabNav
            activeTab={activeTab}
            ariaLabel="Workspace"
            onTabChange={(tab) => {
              if (reviewOpen) minimizeReview()
              setActiveTab(tab)
            }}
            tabs={workspaceTabs}
          />
          <StorageMeter
            className="mock-shell__side-foot"
            label="On-device storage"
            total={storageUsage.total}
            used={storageUsage.used}
          />
        </GlassPanel>

        <main
          className="mock-shell__work"
          ref={(element) => {
            workElement.current = element
          }}
          tabIndex={-1}
        >
          {reviewOpen ? (
            <div className="mock-screen">
              <div className="mock-shell__review-tools">
                <Button autoFocus onPress={minimizeReview} variant="quiet">
                  Minimize review
                </Button>
              </div>
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
            </div>
          ) : activeTab === 'history' ? (
            <HistoryMock onOpenReview={openReview} />
          ) : (
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
          )}
        </main>

        <aside aria-label="Utilities" className="mock-shell__rail">
          <Button onPress={() => setKeysOpen(true)} variant="secondary">
            API keys
          </Button>
          <Button onPress={() => setHelpOpen(true)} variant="secondary">
            Help
          </Button>
          <div className="mock-shell__rail-foot">
            <ThemeSwitcher className="mock-theme-vertical" />
            <Badge tone="primary">Mockup</Badge>
            <Button onPress={onExit} variant="quiet">
              Exit mockups
            </Button>
          </div>
        </aside>
      </div>

      <Dialog
        description={keyCopy.failoverExplainer}
        isOpen={keysOpen}
        onOpenChange={setKeysOpen}
        title="API keys"
      >
        <KeysMock onProvidersChange={setProviders} providers={providers} />
      </Dialog>

      <Dialog
        description={firstRunCopy.welcome}
        isOpen={helpOpen}
        onOpenChange={setHelpOpen}
        title="Help"
      >
        <HelpMock
          onRestartWalkthrough={() => {
            setHelpOpen(false)
            resetConvert()
            setFirstRun(true)
          }}
        />
      </Dialog>
    </div>
  )
}
