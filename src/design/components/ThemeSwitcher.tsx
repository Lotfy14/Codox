import { Button as AriaButton } from 'react-aria-components/Button'
import { useId } from 'react'
import { appMessages } from '../../copy/messages'
import { useTheme, type ThemePreference } from '../theme'

const options: ReadonlyArray<{ icon: 'sun' | 'moon'; label: string; value: ThemePreference }> = [
  { icon: 'sun', label: appMessages.themeLight, value: 'light' },
  { icon: 'moon', label: appMessages.themeDark, value: 'dark' },
]

function ThemeIcon({ icon }: { icon: 'sun' | 'moon' }) {
  return icon === 'sun' ? (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  ) : (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  )
}

export interface ThemeSwitcherProps {
  className?: string
}

export function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const { resolvedTheme, setPreference } = useTheme()
  const labelId = useId()

  return (
    <div className={['ds-theme-switcher', className].filter(Boolean).join(' ')}>
      <span className="sr-only" id={labelId}>{appMessages.themeGroupLabel}</span>
      <div aria-labelledby={labelId} className="ds-theme-switcher__options" role="group">
        {options.map((option) => (
          <AriaButton
            aria-label={option.label}
            aria-pressed={resolvedTheme === option.value}
            className="ds-theme-switcher__option"
            key={option.value}
            onPress={() => setPreference(option.value)}
          >
            <ThemeIcon icon={option.icon} />
          </AriaButton>
        ))}
      </div>
      <span aria-live="polite" className="sr-only">
        {resolvedTheme === 'light' ? appMessages.themeLight : appMessages.themeDark}
      </span>
    </div>
  )
}
