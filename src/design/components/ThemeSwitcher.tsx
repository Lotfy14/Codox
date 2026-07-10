import { Button as AriaButton } from 'react-aria-components/Button'
import { useId } from 'react'
import { useTheme, type ThemePreference } from '../theme'

const themeOptions: ReadonlyArray<{
  label: string
  value: ThemePreference
}> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export interface ThemeSwitcherProps {
  className?: string
  label?: string
}

export function ThemeSwitcher({
  className,
  label = 'Appearance',
}: ThemeSwitcherProps) {
  const { preference, resolvedTheme, setPreference } = useTheme()
  const labelId = useId()

  return (
    <div
      className={['ds-theme-switcher', className].filter(Boolean).join(' ')}
    >
      <span className="ds-theme-switcher__label" id={labelId}>
        {label}
      </span>
      <div
        aria-labelledby={labelId}
        className="ds-theme-switcher__options"
        role="group"
      >
        {themeOptions.map((option) => (
          <AriaButton
            aria-pressed={preference === option.value}
            className="ds-theme-switcher__option"
            key={option.value}
            onPress={() => setPreference(option.value)}
          >
            {option.label}
          </AriaButton>
        ))}
      </div>
      <span aria-live="polite" className="ds-theme-switcher__resolved">
        Showing {resolvedTheme} theme
      </span>
    </div>
  )
}
