import { Button as AriaButton } from 'react-aria-components/Button'

export type AppTab = 'convert' | 'history' | 'keys' | 'help'

export interface TabNavItem {
  id: AppTab
  label: string
}

export interface TabNavProps {
  activeTab: AppTab
  ariaLabel?: string
  className?: string
  onTabChange: (tab: AppTab) => void
}

const appTabs: readonly TabNavItem[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'history', label: 'History' },
  { id: 'keys', label: 'Keys' },
  { id: 'help', label: 'Help' },
]

export function TabNav({
  activeTab,
  ariaLabel = 'Main navigation',
  className,
  onTabChange,
}: TabNavProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={['ds-tab-nav', className].filter(Boolean).join(' ')}
    >
      {appTabs.map((item) => (
        <AriaButton
          aria-current={activeTab === item.id ? 'page' : undefined}
          className="ds-tab-nav__item"
          key={item.id}
          onPress={() => onTabChange(item.id)}
        >
          <span aria-hidden="true" className="ds-tab-nav__indicator" />
          <span>{item.label}</span>
        </AriaButton>
      ))}
    </nav>
  )
}
