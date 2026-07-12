import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Dialog,
  RailButton,
  StorageMeter,
  TabNav,
  ThemeSwitcher,
} from './design/components'
import type { AppTab, TabNavItem } from './design/components'
import { appMessages, firstRunMessages, keyMessages } from './copy/messages'
import { geminiController } from './providers/controller'
import { Convert } from './screens/Convert'
import { FirstRun } from './screens/FirstRun'
import { HelpContent } from './screens/HelpContent'
import { History } from './screens/History'
import { KeysPanel } from './screens/KeysPanel'
import { useFirstRunCompleted } from './state/settings'
import { useStorageEstimate } from './state/storage'

const PdfSpikeScreen = lazy(() =>
  import('./screens/PdfSpike').then(({ PdfSpike }) => ({ default: PdfSpike })),
)

type OpenDialog = 'api' | 'help' | 'privacy' | null
type MobileNavItem = AppTab | Exclude<OpenDialog, null | 'privacy'>

const workspaceItems: readonly TabNavItem<AppTab>[] = [
  { id: 'convert', label: appMessages.navConvert },
  { id: 'history', label: appMessages.navHistory },
]

const mobileItems: readonly TabNavItem<MobileNavItem>[] = [
  ...workspaceItems,
  { id: 'api', label: appMessages.railApi },
  { id: 'help', label: appMessages.railHelp },
]

function RailIcon({ kind }: { kind: 'api' | 'help' }) {
  return kind === 'api' ? (
    <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path d="M8 12h8M12 8v8M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  ) : (
    <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M9.8 9a2.3 2.3 0 1 1 3.5 2c-.8.5-1.3 1-1.3 2M12 17h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

function App() {
  const firstRunCompleted = useFirstRunCompleted()
  const storage = useStorageEstimate()
  const [activeTab, setActiveTab] = useState<AppTab>('convert')
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null)
  const [pdfSpikeOpen] = useState(
    () => new URLSearchParams(window.location.search).get('pdfspike') === '1',
  )

  useEffect(() => {
    void geminiController.refreshStatus().catch(() => undefined)
  }, [])

  if (pdfSpikeOpen) {
    return (
      <Suspense fallback={<p>{appMessages.loadingPdfCheck}</p>}>
        <PdfSpikeScreen />
      </Suspense>
    )
  }

  if (firstRunCompleted === null) return null
  if (!firstRunCompleted) {
    return <FirstRun onDone={() => setActiveTab('convert')} />
  }

  const handleMobileNav = (item: MobileNavItem) => {
    if (item === 'convert' || item === 'history') setActiveTab(item)
    else setOpenDialog(item)
  }

  return (
    <div className="ds-stage">
      <div className="ds-frame">
        <aside className="ds-sidebar">
          <span className="ds-brand">
            <img alt="" height="40" src="/logo.svg" width="40" />
            <span>
              <strong>{appMessages.brandName}</strong>
              <small>{appMessages.brandTagline}</small>
            </span>
          </span>
          <span className="ds-tab-nav__label">{appMessages.navLabel}</span>
          <TabNav
            activeTab={activeTab}
            ariaLabel={appMessages.navLabel}
            items={workspaceItems}
            onTabChange={setActiveTab}
          />
          {storage !== null ? (
            <div className="ds-sidebar__foot">
              <StorageMeter
                label={appMessages.storageLabel}
                total={storage.total}
                used={storage.used}
              />
            </div>
          ) : null}
        </aside>

        <main className="ds-work">
          {activeTab === 'convert' ? <Convert /> : <History />}
        </main>

        <aside className="ds-rail">
          <RailButton
            icon={<RailIcon kind="api" />}
            label={appMessages.railApi}
            onPress={() => setOpenDialog('api')}
          />
          <RailButton
            icon={<RailIcon kind="help" />}
            label={appMessages.railHelp}
            onPress={() => setOpenDialog('help')}
          />
          <div className="ds-rail__foot">
            <ThemeSwitcher />
            <button
              className="ds-rail__privacy"
              onClick={() => setOpenDialog('privacy')}
              type="button"
            >
              {appMessages.railPrivacy}
            </button>
          </div>
        </aside>

        <TabNav<MobileNavItem>
          activeTab={activeTab}
          ariaLabel={appMessages.navLabel}
          className="ds-mobile-nav"
          items={mobileItems}
          onTabChange={handleMobileNav}
        />
      </div>

      <Dialog
        dismissLabel={appMessages.dialogDismiss}
        isOpen={openDialog === 'api'}
        onOpenChange={(open) => setOpenDialog(open ? 'api' : null)}
        title={appMessages.apiDialogTitle}
      >
        <KeysPanel />
      </Dialog>
      <Dialog
        dismissLabel={appMessages.dialogDismiss}
        isOpen={openDialog === 'help'}
        onOpenChange={(open) => setOpenDialog(open ? 'help' : null)}
        title={appMessages.helpDialogTitle}
      >
        <HelpContent />
      </Dialog>
      <Dialog
        dismissLabel={appMessages.dialogDismiss}
        isOpen={openDialog === 'privacy'}
        onOpenChange={(open) => setOpenDialog(open ? 'privacy' : null)}
        title={appMessages.privacyDialogTitle}
      >
        <div className="ds-dialog-copy">
          <p>{firstRunMessages.privacyNotice}</p>
          <p>{keyMessages.keyOwnership}</p>
        </div>
      </Dialog>
    </div>
  )
}

export default App
