import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell, Button, TabNav } from './design/components'
import type { AppTab } from './design/components'
import { geminiController } from './providers/controller'
import { useFirstRunCompleted } from './state/settings'
import { FirstRun } from './screens/FirstRun'
import { KeysPanel } from './screens/KeysPanel'
import {
  ConvertPlaceholder,
  HelpPlaceholder,
  HistoryPlaceholder,
} from './screens/Placeholders'
import './screens/app.css'

const DesignGalleryScreen = import.meta.env.DEV
  ? lazy(() =>
      import('./screens/DesignGallery').then(({ DesignGallery }) => ({
        default: DesignGallery,
      })),
    )
  : null

const MockupAppScreen = import.meta.env.DEV
  ? lazy(() =>
      import('./mockups/MockupApp').then(({ MockupApp }) => ({
        default: MockupApp,
      })),
    )
  : null

// Phase-2 evidence surface — must stay reachable in dev.
const SpikeScreen = import.meta.env.DEV
  ? lazy(() =>
      import('./screens/Phase2SpikeChecks').then(({ Phase2SpikeChecks }) => ({
        default: Phase2SpikeChecks,
      })),
    )
  : null

/** Dev-only review surfaces; not part of the product navigation. */
type DevView = 'gallery' | 'spike' | null

function renderTab(tab: AppTab) {
  switch (tab) {
    case 'convert':
      return <ConvertPlaceholder />
    case 'history':
      return <HistoryPlaceholder />
    case 'keys':
      return <KeysPanel />
    case 'help':
      return <HelpPlaceholder />
  }
}

function App() {
  const firstRunCompleted = useFirstRunCompleted()
  const [activeTab, setActiveTab] = useState<AppTab>('convert')

  const devAvailable = import.meta.env.DEV
  const [devView, setDevView] = useState<DevView>(() => {
    if (!devAvailable) return null
    const params = new URLSearchParams(window.location.search)
    if (params.get('gallery') === '1') return 'gallery'
    if (params.get('spike') === '1') return 'spike'
    return null
  })
  const [mockupsOpen, setMockupsOpen] = useState(
    () =>
      devAvailable &&
      new URLSearchParams(window.location.search).get('mockups') === '1',
  )

  // Startup reachability probe: updates the stored Gemini status. Harmless
  // with no key, and it never marks a key wrong without a real auth failure.
  useEffect(() => {
    void geminiController.refreshStatus().catch(() => undefined)
  }, [])

  if (mockupsOpen && MockupAppScreen) {
    return (
      <Suspense fallback={<p>Loading mockups...</p>}>
        <MockupAppScreen onExit={() => setMockupsOpen(false)} />
      </Suspense>
    )
  }

  // Wait for the stored answer instead of flashing the walkthrough.
  if (firstRunCompleted === null) return null

  if (!firstRunCompleted) {
    return <FirstRun onDone={() => setActiveTab('convert')} />
  }

  return (
    <AppShell
      header={
        <div className="app-header-row">
          <span className="app-brand">
            <img alt="" height="40" src="/logo.svg" width="40" />
            <span>
              <strong>Codox</strong>
              <small>Exam PDFs → Triviadox</small>
            </span>
          </span>
          {devAvailable ? (
            <div className="app-dev-nav">
              <Button
                onPress={() =>
                  setDevView((view) => (view === 'gallery' ? null : 'gallery'))
                }
                variant="quiet"
              >
                Gallery
              </Button>
              <Button
                onPress={() =>
                  setDevView((view) => (view === 'spike' ? null : 'spike'))
                }
                variant="quiet"
              >
                Spike
              </Button>
              <Button onPress={() => setMockupsOpen(true)} variant="quiet">
                Mockups
              </Button>
            </div>
          ) : null}
        </div>
      }
      navigation={
        <TabNav
          activeTab={activeTab}
          onTabChange={(tab) => {
            setDevView(null)
            setActiveTab(tab)
          }}
        />
      }
    >
      {devView === 'gallery' && DesignGalleryScreen ? (
        <Suspense fallback={<p>Loading design gallery...</p>}>
          <DesignGalleryScreen />
        </Suspense>
      ) : devView === 'spike' && SpikeScreen ? (
        <Suspense fallback={<p>Loading spike checks...</p>}>
          <SpikeScreen />
        </Suspense>
      ) : (
        renderTab(activeTab)
      )}
    </AppShell>
  )
}

export default App
