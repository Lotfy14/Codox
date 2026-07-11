export type AppStep = 'setup' | 'upload' | 'progress' | 'review' | 'export'

export interface JobState {
  id: string
  createdAt: number
  step: AppStep
}

/**
 * Outcome of the most recent live key validation, in the pinned taxonomy's
 * key-relevant subset. Wrong key ≠ unreachable ≠ quota — never collapsed.
 */
export type KeyValidationStatus =
  | 'working'
  | 'wrong-key'
  | 'unreachable'
  | 'quota-paused'

/**
 * The one Gemini credential on this installation. The fixed `'gemini'` id
 * makes the record a singleton: there is no way to store a second active
 * key or another provider's key (quota-isolation rule, CLAUDE.md).
 */
export interface GeminiCredential {
  id: 'gemini'
  apiKey: string
  lastValidation?: {
    status: KeyValidationStatus
    checkedAt: number
  }
}
