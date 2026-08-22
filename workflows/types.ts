/**
 * The contract every named conversion workflow implements.
 *
 * A workflow owns its own STRATEGY — how pages are rendered, which models
 * each of its steps uses, how it reads a document, and how it decides an
 * answer. What it does NOT own is device/account plumbing (the pdfium
 * binding, the measured JPEG encoder probe, the one on-device Gemini key,
 * the per-model quota tally, IndexedDB) or the OUTPUT contract every
 * workflow must produce: `ExamQuestion`s and the run artifacts Review, export,
 * backup, and folders read. That shared output is what lets one Review
 * screen and one "Export to Triviadox" work for every mineral.
 *
 * Keep this module free of runtime imports from any workflow: it is pulled
 * in by the widely-imported settings module, and a static import of an
 * engine here would drag every prompt string and the pdfium WASM into
 * bundles that only wanted to read a setting. Workflows load their
 * implementation lazily inside `run`.
 */
import type { EngineModel } from '../src/providers/gemini'

/**
 * How a workflow wants pages rasterised. The rasteriser itself is shared
 * device plumbing (`src/pdf`) — these are the knobs the workflow sets on it,
 * so two minerals can render at different fidelity without either carrying
 * its own copy of pdfium or re-running the encoder probe.
 */
export interface WorkflowRenderPolicy {
  /** Rendered-page DPI. */
  dpi: number
  /**
   * Pages between pdfium destroy/re-init cycles — the native-heap safety net
   * behind CLAUDE.md's mobile memory discipline. Lower is safer on small
   * devices and slower everywhere.
   */
  reinitEvery: number
}

/** One Customize picker, setting every step it names to the same model. */
export interface WorkflowModelGroup {
  /** Step ids this control sets together. Must exist in `steps`. */
  steps: readonly string[]
  /** Tutor-facing control label. */
  label: string
  /** One-line explanation of what these steps do. */
  hint: string
}

/**
 * A workflow's model-selection surface. The tutor picks each step's PRIMARY
 * from the two selectable models; the model NOT picked becomes that step's
 * runtime fallback, applied by the controller under the SAME one key — a
 * second model, never a second key or provider.
 */
export interface WorkflowModelPolicy {
  /** Every request-making step, in pipeline order. */
  steps: readonly string[]
  /** Primary model per step before the tutor changes anything. */
  defaults: Readonly<Record<string, EngineModel>>
  /** How Customize groups those steps into pickers, in display order. */
  groups: readonly WorkflowModelGroup[]
}

/** Everything a workflow needs to convert (or resume) one exam PDF. */
export interface WorkflowRunOptions {
  signal?: AbortSignal
  /** Intake page counts make render checkpoints complete and resumable. */
  examPageCount?: number
  /** Separate answer-key document, appended after the exam pages. */
  answerKeyBytes?: Uint8Array
  answerKeyPageCount?: number
  /** A raster MIME type routes the key in as one already-rendered page. */
  answerKeyMimeType?: string
  /**
   * The tutor's Customize choices for this batch. Shared knobs are named;
   * `models` is keyed by this workflow's own step ids.
   *
   * Window sizes, batch sizes and crop passes are deliberately NOT here: they
   * are pipeline shape, which belongs to the workflow that runs the pipeline.
   * A shared option only makes sense when every mineral must honour it, and a
   * second strategy has no INDEX window or BOX pass to size.
   */
  matchingMode?: 'skip' | 'split'
  models?: Readonly<Record<string, string>>
}

/**
 * How a run ended. `reason` and the step names behind it are workflow-owned
 * strings — `RunState` stores them loosely for exactly this reason, so a new
 * mineral can stop for its own reasons without editing shared storage.
 */
export type WorkflowRunOutcome =
  | {
      status: 'done'
      runId: string
      csv: string
      flaggedRows: number
      notSafeToImport: boolean
    }
  /** A content stop: the workflow could not proceed on what it was given. */
  | { status: 'stopped'; runId: string; reason: string }
  /**
   * Not a content stop — the provider itself ended the run. Kept distinct so
   * the UI can say "bad key" vs "Gemini is unreachable" (never "failed").
   * Quota and offline never land here: the controller absorbs them.
   */
  | {
      status: 'provider-stopped'
      runId: string
      kind: 'wrong-key' | 'provider-error'
    }
  /** Aborted (tab closed, user stopped): artifacts stand, the run resumes. */
  | { status: 'aborted'; runId: string }

/** A named, benchmarked conversion strategy available to tutors. */
export interface WorkflowDefinition {
  /** Stable persisted id. Never reuse an id for a different strategy. */
  id: string
  /** Tutor-facing mineral name. */
  name: string
  /** Semantic version of this workflow's behavior and benchmark contract. */
  version: string
  /** Short Customize-panel explanation. */
  description: string
  /** True only after the workflow clears its declared benchmark suite. */
  status: 'verified' | 'experimental'
  /** This workflow's rasterisation settings. */
  render: WorkflowRenderPolicy
  /** This workflow's steps, their default models, and their Customize UI. */
  models: WorkflowModelPolicy
  /**
   * Convert (or resume) one exam PDF, writing the shared run artifacts.
   * Must load its implementation lazily — see the module note above.
   */
  run: (
    runId: string,
    pdfBytes: Uint8Array,
    options: WorkflowRunOptions,
  ) => Promise<WorkflowRunOutcome>
}
