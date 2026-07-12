import { Button as AriaButton } from 'react-aria-components/Button'
import type { ReactNode } from 'react'

export type AppTab = 'convert' | 'history'

export interface TabNavItem<T extends string> {
  id: T
  icon?: ReactNode
  label: string
}

export interface TabNavProps<T extends string> {
  activeTab: T
  ariaLabel: string
  className?: string
  items: readonly TabNavItem<T>[]
  onTabChange: (tab: T) => void
}

export function TabNav<T extends string>({
  activeTab,
  ariaLabel,
  className,
  items,
  onTabChange,
}: TabNavProps<T>) {
  return (
    <nav aria-label={ariaLabel} className={['ds-tab-nav', className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <AriaButton
          aria-current={activeTab === item.id ? 'page' : undefined}
          className="ds-tab-nav__item"
          key={item.id}
          onPress={() => onTabChange(item.id)}
        >
          <span aria-hidden="true" className="ds-tab-nav__indicator" />
          {item.icon !== undefined ? (
            <span aria-hidden="true" className="ds-tab-nav__icon">{item.icon}</span>
          ) : null}
          <span>{item.label}</span>
        </AriaButton>
      ))}
    </nav>
  )
}
