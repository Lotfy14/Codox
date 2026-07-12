import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export const THEME_STORAGE_KEY = 'codox-theme-preference'

interface ThemeSnapshot {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
}

const serverSnapshot: ThemeSnapshot = {
  preference: 'system',
  resolvedTheme: 'light',
}

const listeners = new Set<() => void>()
let listening = false

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark = systemPrefersDark(),
): ResolvedTheme {
  if (preference === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return preference
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme

  const themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )
  themeColor?.setAttribute('content', theme === 'dark' ? '#191013' : '#f4e9e0')
}

let snapshot: ThemeSnapshot = (() => {
  const preference = readStoredPreference()
  return { preference, resolvedTheme: resolveTheme(preference) }
})()

applyResolvedTheme(snapshot.resolvedTheme)

function publish(nextPreference = snapshot.preference): void {
  const nextSnapshot: ThemeSnapshot = {
    preference: nextPreference,
    resolvedTheme: resolveTheme(nextPreference),
  }

  const changed =
    nextSnapshot.preference !== snapshot.preference ||
    nextSnapshot.resolvedTheme !== snapshot.resolvedTheme

  snapshot = nextSnapshot
  applyResolvedTheme(snapshot.resolvedTheme)

  if (changed) {
    listeners.forEach((listener) => listener())
  }
}

function handleSystemThemeChange(): void {
  if (snapshot.preference === 'system') {
    publish()
  }
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== THEME_STORAGE_KEY && event.key !== null) {
    return
  }

  publish(isThemePreference(event.newValue) ? event.newValue : 'system')
}

function startListening(): void {
  if (listening || typeof window === 'undefined') {
    return
  }

  listening = true
  window.addEventListener('storage', handleStorage)
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', handleSystemThemeChange)
}

function subscribe(listener: () => void): () => void {
  startListening()
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ThemeSnapshot {
  return snapshot
}

export function setThemePreference(preference: ThemePreference): void {
  if (!isThemePreference(preference)) {
    return
  }

  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference)
    }
  } catch {
    // The preference still applies for this session when storage is blocked.
  }

  publish(preference)
}

export function useTheme() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot)

  return {
    ...current,
    setPreference: setThemePreference,
  }
}

// Keep system and cross-tab changes live even on screens without a switcher.
startListening()
