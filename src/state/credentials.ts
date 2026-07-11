import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { GeminiCredential, KeyValidationStatus } from './types'

/**
 * The only credential repository in Codox. Every cloud request obtains its
 * key from here and nowhere else — no environment variable, import, sync,
 * fallback, or remote lookup may supply one (CLAUDE.md quota rule). The
 * fixed id makes a second active key unrepresentable.
 *
 * Key hygiene: values from this module must never reach console output,
 * thrown errors, status events, or URLs.
 */
const GEMINI_CREDENTIAL_ID = 'gemini'

export async function getGeminiCredential(): Promise<
  GeminiCredential | undefined
> {
  return db.credentials.get(GEMINI_CREDENTIAL_ID)
}

/**
 * Stores or replaces the one Gemini key. Any previous key and its
 * validation result are overwritten — replacement, never accumulation.
 */
export async function saveGeminiKey(apiKey: string): Promise<void> {
  await db.credentials.put({ id: GEMINI_CREDENTIAL_ID, apiKey })
}

export async function removeGeminiKey(): Promise<void> {
  await db.credentials.delete(GEMINI_CREDENTIAL_ID)
}

/** Records the outcome of a live key check against the stored key. */
export async function recordKeyValidation(
  status: KeyValidationStatus,
): Promise<void> {
  await db.credentials.update(GEMINI_CREDENTIAL_ID, {
    lastValidation: { status, checkedAt: Date.now() },
  })
}

/**
 * Live view of the singleton credential. `null` while the first read is in
 * flight, `undefined` when no key is stored.
 */
export function useGeminiCredential(): GeminiCredential | null | undefined {
  return useLiveQuery(() => db.credentials.get(GEMINI_CREDENTIAL_ID), [], null)
}
