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
 * One engine run: exactly one exam PDF converted end to end. `step` plus
 * the artifacts present are the checkpoint — resume re-enters the executor
 * at the first step whose outputs are missing.
 */
export interface RunState {
  id: string
  jobId: string
  pdfId: string
  fileName: string
  status: 'running' | 'paused' | 'stopped' | 'done'
  /** §1.3's machine-readable stop reason, when status is 'stopped'. */
  stopReason?: string
  /** The step the executor is at / stopped in. */
  step: string
  /** Set when validation, crops, or the audit say the CSV is not safe. */
  notSafeToImport?: boolean
  /** Set when the audit call itself failed — never an inferred pass. */
  auditUnavailable?: boolean
  /** Pages that failed to render; the run continued past them. */
  badPages?: number[]
  /** Progress counters — persisted, so a reload redraws the same bars. */
  pageCount?: number
  pagesRendered?: number
  chunkCount?: number
  chunksDone?: number
  /** True when the user's declaration contradicted the planner's policy. */
  wrongDeclaration?: boolean
  /** Rows whose correct_index is blank + flagged at the end of the run. */
  flaggedRows?: number
  /** Quota burn: every Gemini request this run made, and its token totals. */
  requestCount?: number
  promptTokens?: number
  candidatesTokens?: number
  totalTokens?: number
  /** Set when the run's bundle last left the device (export-early law). */
  exportedAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * Every step's inputs and outputs, on disk before the next step starts
 * (CODOX_MIGRATION §1.3). Exactly one of `blob` / `json` / `text` is set.
 */
export type RunArtifactKind =
  | 'page-jpeg'
  | 'page-text'
  | 'blueprint-raw'
  | 'blueprint-valid'
  | 'crop'
  | 'chunk-request'
  | 'chunk-response'
  | 'merged-rows'
  | 'csv'
  | 'audit-report'
  | 'review-resolutions'

export interface RunArtifact {
  id: string
  runId: string
  kind: RunArtifactKind
  /** 0-based page index for page artifacts; crop's source page. */
  pageIndex?: number
  chunkIndex?: number
  /** Relative bundle path for crops, e.g. `images/asset01.jpg`. */
  path?: string
  /** Page size in pixels — pinned with the JPEG so boxes stay meaningful. */
  width?: number
  height?: number
  /**
   * JPEG bytes (pages, crops). Stored as raw bytes rather than a Blob:
   * structured-cloneable in every IndexedDB implementation, and already
   * the shape the Phase-7 zip writer wants. A page JPEG is ~35 KB — the
   * per-page memory discipline is unaffected (one artifact is read at a
   * time, never the whole document).
   */
  bytes?: Uint8Array
  json?: unknown
  text?: string
  createdAt: number
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
