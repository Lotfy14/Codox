export type AppStep = 'setup' | 'upload' | 'progress' | 'review' | 'export'

/**
 * Where the exported `year` column comes from (Customizations tab):
 * 'off' — no year column; 'type' — the user-typed job year stamped on
 * every row; 'ai' — the planner's document-evidence year, blank when the
 * document shows none (no extra AI requests — the engine already emits it).
 */
export type YearMode = 'off' | 'type' | 'ai'

/** One user-provided topic and its subtopics — the matcher's whole world. */
export interface TopicItem {
  topic: string
  subtopics: string[]
}

export interface JobState {
  id: string
  createdAt: number
  step: AppStep
  /** Keep the original PDF stored after conversion (History re-runs). */
  keepOriginal?: boolean
  /** User-typed year, applied to every question when yearMode is 'type'. */
  typedYear?: string
  /** The user's topic list — typed or extracted from a topics document. */
  topics?: TopicItem[]
}

/**
 * One PDF stored for the current job — the exam files plus at most one
 * answer-key file and at most one topics document per job. The blob is
 * the user's original file; IndexedDB holding it is what lets a job
 * survive reloads. A `topics` entry may also be an image (png/jpeg/webp).
 */
export interface StoredPdf {
  id: string
  jobId: string
  kind: 'exam' | 'answer-key' | 'topics'
  name: string
  size: number
  pageCount: number
  addedAt: number
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
  /** Separate key used by this run, when one was actually processed. */
  answerKeyPdfId?: string
  fileName: string
  status: 'running' | 'paused' | 'stopped' | 'done'
  /** §1.3's machine-readable stop reason, when status is 'stopped'. */
  stopReason?: string
  /** The step the executor is at / stopped in. */
  step: string
  /**
   * When the current step began (ms epoch) — diagnostics only, powers the
   * debug console's live "elapsed on this step" clock. Never affects the
   * engine's behaviour or the checkpoint.
   */
  stepStartedAt?: number
  /** Set when validation, crops, or the audit say the CSV is not safe. */
  notSafeToImport?: boolean
  /** Set when the audit call itself failed — never an inferred pass. */
  auditUnavailable?: boolean
  /** Pages that failed to render; the run continued past them. */
  badPages?: number[]
  /** Non-fatal planner findings; successful rows are still kept. */
  planningIssues?: PlanningIssue[]
  /** Progress counters — persisted, so a reload redraws the same bars. */
  pageCount?: number
  pagesRendered?: number
  chunkCount?: number
  chunksDone?: number
  /** INDEX-window progress, checkpointed independently of worker chunks. */
  plannerWindowCount?: number
  plannerWindowsDone?: number
  /** Rows whose correct_index is blank + flagged at the end of the run. */
  flaggedRows?: number
  /** Quota burn: every Gemini request this run made, and its token totals. */
  requestCount?: number
  promptTokens?: number
  candidatesTokens?: number
  totalTokens?: number
  /** Exact model that produced this run's structure and image boxes. */
  plannerModel?: string
  /** Set when the run's bundle last left the device (export-early law). */
  exportedAt?: number
  /**
   * Snapshot of the year setting at run creation — History exports keep
   * the columns the run was made with, whatever the user changes later.
   * Absent on pre-feature runs, which read as 'off'.
   */
  yearMode?: YearMode
  /** The job's typed year at run creation, when yearMode is 'type'. */
  typedYear?: string
  createdAt: number

  updatedAt: number
}

export interface PlanningIssue {
  kind: 'missing_question' | 'unreadable_page' | 'figure_unreadable'
  page?: number
  section?: string
  printedLabel?: string
  rowRef?: string
  reason?: string
}

export interface LogEvent {
  seq?: number
  t: number
  level: 'info' | 'warn' | 'error'
  scope: 'key' | 'provider' | 'engine' | 'export' | 'app'
  event: string
  runId?: string
  page?: number
  ref?: string
  reason?: string
  detail?: Record<string, unknown>
}


/**
 * Every step's inputs and outputs, on disk before the next step starts
 * (CODOX_MIGRATION §1.3). Exactly one of `blob` / `json` / `text` is set.
 */
export type RunArtifactKind =
  | 'page-jpeg'
  | 'page-text'
  | 'blueprint-raw'
  | 'index-window'
  | 'index-reconcile'
  | 'figure-window'
  | 'blueprint-valid'
  | 'crop'
  | 'chunk-request'
  | 'chunk-response'
  | 'merged-rows'
  | 'csv'
  | 'audit-report'
  | 'review-resolutions'
  | 'review-edits'
  | 'ai-answers'
  | 'topics-list'
  | 'topic-matches'

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
  | 'setup-required'

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
