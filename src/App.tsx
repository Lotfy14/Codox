import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell, TabNav } from './design/components'
import type { AppTab } from './design/components'
import { geminiController } from './providers/controller'
import { useFirstRunCompleted } from './state/settings'
import { Convert } from './screens/Convert'
import { FirstRun } from './screens/FirstRun'
import { KeysPanel } from './screens/KeysPanel'
import { HelpPlaceholder, HistoryPlaceholder } from './screens/Placeholders'
import './screens/app.css'

// Phase-5 diagnostic surface. Deliberately available in production builds:
// the memory stress test runs on the shipped .apk/PWA (see PHASE5_PLAN.md).
const PdfSpikeScreen = lazy(() =>
  import('./screens/PdfSpike').then(({ PdfSpike }) => ({
    default: PdfSpike,
  })),
)

function renderTab(tab: AppTab) {
  switch (tab) {
    case 'convert':
      return <Convert />
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

  const [pdfSpikeOpen] = useState(
    () => new URLSearchParams(window.location.search).get('pdfspike') === '1',
  )

  // Startup reachability probe: updates the stored Gemini status. Harmless
  // with no key, and it never marks a key wrong without a real auth failure.
  useEffect(() => {
    void geminiController.refreshStatus().catch(() => undefined)
  }, [])

  if (pdfSpikeOpen) {
    return (
      <Suspense fallback={<p>Loading PDF check...</p>}>
        <PdfSpikeScreen />
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
        </div>
      }
      navigation={<TabNav activeTab={activeTab} onTabChange={setActiveTab} />}
    >
      {renderTab(activeTab)}
    </AppShell>
  )
}

export default App
