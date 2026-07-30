/**
 * Storage protection.
 *
 * IndexedDB is "best-effort" by default: the browser may evict an origin's
 * entire database — history, folders, every extracted question and every
 * review edit — when it is short of disk, silently and without asking. Codox
 * is the only holder of a tutor's work between conversion and export, so
 * best-effort is not good enough; a wiped database is a wiped afternoon.
 *
 * `navigator.storage.persist()` upgrades the origin to "persistent", which
 * browsers do not evict automatically. Chrome/Edge grant it silently once the
 * site is installed, bookmarked, or has engagement history; Firefox asks the
 * user. We therefore request it at the moment work is first stored rather than
 * at cold start, so any prompt arrives with a visible reason behind it.
 *
 * This is prevention, not a guarantee — a user clearing site data still clears
 * it. `src/state/backup.ts` is the recovery half.
 */
import { useEffect, useState } from 'react'

export type StorageProtection =
  /** The browser will not evict this origin on its own. */
  | 'protected'
  /** Storable, but evictable under disk pressure — the risky default. */
  | 'best-effort'
  /** No Storage API here; nothing to ask for and nothing to promise. */
  | 'unsupported'

interface StorageManagerLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
}

function storageManager(): StorageManagerLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { storage?: StorageManagerLike }).storage
}

const listeners = new Set<(state: StorageProtection) => void>()
let lastKnown: StorageProtection | null = null
let request: Promise<StorageProtection> | null = null

function publish(state: StorageProtection): StorageProtection {
  lastKnown = state
  for (const listener of listeners) listener(state)
  return state
}

/** Reads the current state without asking for anything. */
export async function readStorageProtection(): Promise<StorageProtection> {
  const storage = storageManager()
  if (storage?.persisted === undefined) return publish('unsupported')
  try {
    return publish((await storage.persisted()) ? 'protected' : 'best-effort')
  } catch {
    return publish('unsupported')
  }
}

async function askOnce(): Promise<StorageProtection> {
  const storage = storageManager()
  if (storage?.persist === undefined || storage.persisted === undefined) {
    return publish('unsupported')
  }
  try {
    if (await storage.persisted()) return publish('protected')
    return publish((await storage.persist()) ? 'protected' : 'best-effort')
  } catch {
    // A denied prompt or a locked-down context: storable, just not protected.
    return publish('best-effort')
  }
}

/**
 * Ask the browser to protect this origin's storage, at most once per session.
 * Safe to call from every write path — the promise is memoized, so the browser
 * is asked once no matter how many PDFs or runs are created.
 */
export function ensureStoragePersisted(): Promise<StorageProtection> {
  request ??= askOnce()
  return request
}

/**
 * Ask again after a refusal. Chrome's answer depends on engagement, so a
 * request that failed on first launch can succeed later — this is what the
 * "Protect my work" button in the backup panel calls.
 */
export function requestStoragePersistedAgain(): Promise<StorageProtection> {
  request = askOnce()
  return request
}

/** Test-only: forget the memoized request so the next call asks again. */
export function resetStoragePersistForTests(): void {
  request = null
  lastKnown = null
}

export function subscribeStorageProtection(
  listener: (state: StorageProtection) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function lastStorageProtection(): StorageProtection | null {
  return lastKnown
}

/** Live protection state for the UI; null until the first read lands. */
export function useStorageProtection(): StorageProtection | null {
  const [state, setState] = useState<StorageProtection | null>(lastKnown)
  useEffect(() => {
    const unsubscribe = subscribeStorageProtection(setState)
    void readStorageProtection()
    return unsubscribe
  }, [])
  return state
}
