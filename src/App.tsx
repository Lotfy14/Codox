import { useEffect, useState } from 'react'
import {
  Dialog,
  Logo,
  RailButton,
  StorageMeter,
  TabNav,
  ThemeSwitcher,
} from './design/components'
import type { AppTab, TabNavItem } from './design/components'
import { appMessages, privacyMessages } from './copy/messages'
import { geminiController } from './providers/controller'
import { Convert } from './screens/Convert'
import { ApiCoachmark } from './screens/ApiCoachmark'
import { HelpContent } from './screens/HelpContent'
import { History } from './screens/History'
import { KeysPanel } from './screens/KeysPanel'
import {
  dismissApiCoachmark,
  useApiCoachmarkDismissed,
} from './state/settings'
import { useStorageEstimate } from './state/storage'

type OpenDialog = 'api' | 'help' | 'privacy' | null
type MobileNavItem = AppTab | Exclude<OpenDialog, null | 'privacy'>

function NavIcon({ kind }: { kind: AppTab }) {
  return kind === 'convert' ? (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4h10l6 6v10H4z" />
      <path d="M14 4v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ) : (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function RailIcon({ kind }: { kind: 'api' | 'help' }) {
  return kind === 'api' ? (
    <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path
        d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle cx="16.5" cy="7.5" fill="currentColor" r="0.5" />
    </svg>
  ) : (
    <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M9.8 9a2.3 2.3 0 1 1 3.5 2c-.8.5-1.3 1-1.3 2M12 17h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

const workspaceItems: readonly TabNavItem<AppTab>[] = [
  { id: 'convert', icon: <NavIcon kind="convert" />, label: appMessages.navConvert },
  { id: 'history', icon: <NavIcon kind="history" />, label: appMessages.navHistory },
]

const mobileItems: readonly TabNavItem<MobileNavItem>[] = [
  ...workspaceItems,
  {
    id: 'api',
    icon: <RailIcon kind="api" />,
    label: appMessages.railApi,
    className: 'api-coachmark__mobile-target',
  },
  { id: 'help', icon: <RailIcon kind="help" />, label: appMessages.railHelp },
]

function App() {
  const coachmarkDismissed = useApiCoachmarkDismissed()
  const storage = useStorageEstimate()
  const [activeTab, setActiveTab] = useState<AppTab>('convert')
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null)
  const [coachmarkHidden, setCoachmarkHidden] = useState(false)
  const showCoachmark = coachmarkDismissed === false && !coachmarkHidden

  useEffect(() => {
    void geminiController.refreshStatus().catch(() => undefined)
  }, [])

  const hideCoachmark = () => {
    setCoachmarkHidden(true)
    void dismissApiCoachmark()
  }

  const openApi = () => {
    hideCoachmark()
    setOpenDialog('api')
  }

  const handleMobileNav = (item: MobileNavItem) => {
    if (showCoachmark) hideCoachmark()
    if (item === 'convert' || item === 'history') setActiveTab(item)
    else setOpenDialog(item)
  }

  return (
    <div className={`ds-stage${showCoachmark ? ' app--coachmark' : ''}`}>
      <div className="ds-frame">
        <aside className="ds-sidebar">
          <div className="ds-brand">
            <span className="ds-brand__lockup">
              <Logo className="ds-brand__logo" />
              <strong>{appMessages.brandName}</strong>
            </span>
            <span className="ds-brand__tools">
              <ThemeSwitcher />
            </span>
          </div>
          <div className="ds-sidebar__mobile-tools">
            {storage !== null ? (
              <StorageMeter
                label={appMessages.storageLabel}
                total={storage.total}
                used={storage.used}
              />
            ) : null}
          </div>
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
                detail="percent"
                label={appMessages.storageLabel}
                total={storage.total}
                used={storage.used}
              />
            </div>
          ) : null}
        </aside>

        <main className="ds-work">
          {activeTab === 'convert' ? (
            <Convert onRequestApiKey={openApi} />
          ) : (
            <History onOpenConvert={() => setActiveTab('convert')} />
          )}
        </main>

        <aside className="ds-rail">
          <RailButton
            className="api-coachmark__desktop-target"
            icon={<RailIcon kind="api" />}
            label={appMessages.railApi}
            onPress={openApi}
          />
          <RailButton
            icon={<RailIcon kind="help" />}
            label={appMessages.railHelp}
            onPress={() => setOpenDialog('help')}
          />
          <div className="ds-rail__foot">
            <ThemeSwitcher />
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
        <HelpContent onOpenApi={openApi} />
      </Dialog>
      <Dialog
        dismissLabel={appMessages.dialogDismiss}
        isOpen={openDialog === 'privacy'}
        onOpenChange={(open) => setOpenDialog(open ? 'privacy' : null)}
        title={appMessages.privacyDialogTitle}
      >
        <div className="privacy-copy">
          <p>{privacyMessages.local}</p>
          <p>{privacyMessages.processing}</p>
          <p>{privacyMessages.quota}</p>
        </div>
      </Dialog>
      {showCoachmark ? (
        <ApiCoachmark onDismiss={hideCoachmark} onOpenApi={openApi} />
      ) : null}
    </div>
  )
}

export default App
