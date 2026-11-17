/**
 * The Key facts mode (Normal / Pro), switched from the top bar (owner ask,
 * 2026-11-17: "something at the top that you switch easily"). One shared
 * value so the top bar and the Key facts screen always agree. Kept in
 * localStorage as a per-device convenience; a lost value means Normal.
 */
import { useSyncExternalStore } from 'react'
import type { KeyFactMode } from './models'

const STORAGE_KEY = 'codox.keyFactMode'
const listeners = new Set<() => void>()

function read(): KeyFactMode {
  try { return localStorage.getItem(STORAGE_KEY) === 'pro' ? 'pro' : 'normal' } catch { return 'normal' }
}

let current: KeyFactMode = typeof window === 'undefined' ? 'normal' : read()

export function getKeyFactMode(): KeyFactMode {
  return current
}

export function setKeyFactMode(next: KeyFactMode): void {
  if (next === current) return
  current = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* per-device convenience */ }
  for (const l of listeners) l()
}

export function useKeyFactMode(): KeyFactMode {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    getKeyFactMode,
    () => 'normal' as KeyFactMode,
  )
}
