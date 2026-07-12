import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark'
export type ResolvedTheme = ThemePreference

export const THEME_STORAGE_KEY = 'codox-theme-preference'

interface ThemeSnapshot {
  preference: ThemePreference | null
  resolvedTheme: ResolvedTheme
}

const serverSnapshot: ThemeSnapshot = {
  preference: null,
  resolvedTheme: 'light',
}

const listeners = new Set<() => void>()
let listening = false

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark'
}

function readStoredPreference(): ThemePreference | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
      return null
    }
    return isThemePreference(stored) ? stored : null
  } catch {
    return null
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
  preference: ThemePreference | null,
  prefersDark = systemPrefersDark(),
): ResolvedTheme {
  return preference ?? (prefersDark ? 'dark' : 'light')
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#191013' : '#f4e9e0')
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
  if (changed) listeners.forEach((listener) => listener())
}

function handleSystemThemeChange(): void {
  if (snapshot.preference === null) publish()
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== THEME_STORAGE_KEY && event.key !== null) return

  if (event.newValue === 'system') {
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    } catch {
      // Storage can be blocked; the legacy preference is still ignored.
    }
  }
  publish(isThemePreference(event.newValue) ? event.newValue : null)
}

function startListening(): void {
  if (listening || typeof window === 'undefined') return

  listening = true
  window.addEventListener('storage', handleStorage)
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', handleSystemThemeChange)
}

function subscribe(listener: () => void): () => void {
  startListening()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ThemeSnapshot {
  return snapshot
}

export function setThemePreference(preference: ThemePreference): void {
  if (!isThemePreference(preference)) return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // The preference still applies for this session when storage is blocked.
  }
  publish(preference)
}

export function useTheme() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot)
  return { ...current, setPreference: setThemePreference }
}

startListening()
