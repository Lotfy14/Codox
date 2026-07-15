import { Button as AriaButton } from 'react-aria-components/Button'
import type { ButtonProps as AriaButtonProps } from 'react-aria-components/Button'
import type { ReactNode } from 'react'

export interface RailButtonProps
  extends Omit<AriaButtonProps, 'children' | 'className'> {
  className?: string
  icon: ReactNode
  label: string
}

export function RailButton({ className, icon, label, ...props }: RailButtonProps) {
  return (
    <AriaButton
      {...props}
      className={['ds-rail-button', className].filter(Boolean).join(' ')}
    >
      <span aria-hidden="true" className="ds-rail-button__icon">
        {icon}
      </span>
      <span className="ds-rail-button__label">{label}</span>
    </AriaButton>
  )
}
