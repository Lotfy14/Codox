export type AppStep = 'setup' | 'upload' | 'progress' | 'review' | 'export'

/**
 * Where the correct answers live for a PDF — the one declaration question
 * on Upload. Mirrors `FileAnswerSource` in the design components.
 */
export type AnswerSource = 'inside' | 'key-file' | 'none'

export interface JobState {
  id: string
  createdAt: number
  step: AppStep
  /** Batch-level answer declaration; per-file overrides live on StoredPdf. */
  batchAnswerSource?: AnswerSource
  /** Keep the original PDF stored after conversion (History re-runs). */
  keepOriginal?: boolean
}

/**
 * One PDF stored for the current job — the exam files plus at most one
 * answer-key file per job. The blob is the user's original file;
 * IndexedDB holding it is what lets a job survive reloads.
 */
export interface StoredPdf {
  id: string
  jobId: string
  kind: 'exam' | 'answer-key'
  name: string
  size: number
  pageCount: number
  addedAt: number
  /** Per-file override of the batch declaration; undefined = batch default. */
  answerSource?: AnswerSource
  blob: Blob
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
