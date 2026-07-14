/**
 * Engine types — the Planner-Worker-Audit pipeline's data shapes, mirroring
 * CODOX_MIGRATION.md §1 (semantics) and §2.1's blueprint JSON shape. Models
 * return `unknown`; `blueprint.ts` and `merge.ts` narrow into these types —
 * nothing a model returns is trusted until it passes those validators.
 */

/** The 10-column working schema (§1.6, §3.1) — order is contract. */
export const CSV_SCHEMA = [
  'id',
  'group_id',
  'topic',
  'subtopic',
  'year',
  'question',
  'options',
  'correct_index',
  'image_urls',
  'needs_review',
] as const

/** `[ymin, xmin, ymax, xmax]`, normalized 0–1000 on the rendered page (§1.8). */
export type Box2d = readonly [number, number, number, number]

/** The five allowed answer-policy types (§1.5). */
export const ANSWER_POLICY_TYPES = [
  'no_answer_key',
  'separate_key',
  'inline_marks',
  'mixed',
  'uncertain',
] as const
export type AnswerPolicyType = (typeof ANSWER_POLICY_TYPES)[number]

/** Policy types that permit the worker to extract visible answers (§1.5). */
export const EVIDENCE_POLICY_TYPES: readonly AnswerPolicyType[] = [
  'separate_key',
  'inline_marks',
  'mixed',
]

export interface AnswerPolicy {
  type: AnswerPolicyType
  answer_key_present: boolean
  marking_style: string
  worker_rule: string
}

export interface DocumentProfile {
  page_count: number
  question_count: number
  group_count: number
  question_pages: number[]
  answer_policy: AnswerPolicy
}

export interface BlueprintAsset {
  asset_id: string
  kind: string
  /** 1-based page number, as the planner prompt's example uses `"page": 1`. */
  page: number
  box_2d: Box2d
  /** Planner-suggested path; code owns the real path (`assetJpegPath`). */
  output_path: string
  linked_group_id: string
  linked_row_ids: string[]
  anchor: string
}

export interface Region {
  page: number
  box_2d: Box2d
  anchor?: string
}

export type QuestionAssemblyMode =
  | 'plain_question_prompt'
  | 'case_stem_plus_question_prompt'

export interface QuestionAssembly {
  mode: QuestionAssemblyMode
  final_format: string
}

export interface PlannedRowRegions {
  case_stem: Region | null
  question_prompt: Region | null
  options: Region | null
  answer_evidence: Region | null
}

export interface CorrectIndexPolicy {
  type: string
  value: string
  needs_review: string
}

export interface WorkerTask {
  case_stem_required: boolean
  read_regions_only: boolean
  must_follow_planner_structure: boolean
}

export interface PlannedRow {
  id: string
  group_id: string
  topic: string
  subtopic: string
  year: string
  question_assembly: QuestionAssembly
  regions: PlannedRowRegions
  image_urls: string[]
  correct_index_policy: CorrectIndexPolicy
  worker_task: WorkerTask
}

export interface WorkerConstraints {
  may_add_rows: boolean
  may_remove_rows: boolean
  may_change_grouping: boolean
  may_change_image_assignments: boolean
  may_change_answer_policy: boolean
  may_flag_planner_disagreement: boolean
}

export interface Blueprint {
  csv_schema: string[]
  document_profile: DocumentProfile
  assets: BlueprintAsset[]
  planned_rows: PlannedRow[]
  worker_constraints: WorkerConstraints
}

/**
 * The reduced blueprint one worker chunk receives (§1.3 step 5 / §1.9):
 * schema, profile, constraints, ONLY the chunk's rows and the assets those
 * rows reference — never the complete row set.
 */
export interface ReducedBlueprint {
  csv_schema: string[]
  document_profile: DocumentProfile
  worker_constraints: WorkerConstraints
  planned_rows: PlannedRow[]
  assets: BlueprintAsset[]
}

/** One row as the worker returns it (§2.2 output shape), post-narrowing. */
export interface WorkerRow {
  id: string
  group_id: string
  topic: string
  subtopic: string
  year: string
  question: string
  options: string[]
  correct_index: string
  image_urls: string[]
  /** Always discarded at merge (§1.4) — carried only for the record. */
  needs_review: string
}

/** One final CSV row. `correct_index` is a digit string or '' (§3.2). */
export interface MergedRow {
  id: string
  group_id: string
  topic: string
  subtopic: string
  year: string
  question: string
  options: string[]
  correct_index: string
  image_urls: string[]
  needs_review: string
}

/** Audit response (§2.3 output shape), post-narrowing. */
export interface AuditReport {
  audit_pass: boolean
  risk_class: 'safe_to_import' | 'not_safe_to_import'
  failed_rows: Array<{ id: string; field: string; reason: string }>
  global_failures: string[]
  answer_policy_violations: string[]
  crop_failures: string[]
  notes: string[]
}

/** §1.3's machine-readable stop reasons, verbatim. */
export type StopReason =
  | 'render_failed'
  | 'planner_unparseable'
  | 'planner_invalid_after_repair'
  | 'worker_chunk_invalid'
  | 'merge_validation_failed'
  /**
   * The planner counted more questions than it emitted rows for, and even a
   * single-page window could not close the gap. Never silently accept the
   * shortfall: a CSV missing most of the exam is worse than an honest stop.
   */
  | 'planner_underextracted'

/** Names of the executor's checkpointed steps, in order. */
export const RUN_STEPS = [
  'render',
  'planner',
  'blueprint',
  'crops',
  'worker',
  'merge',
  'emit',
  'audit',
] as const
export type RunStep = (typeof RUN_STEPS)[number]

export type RunLifecycle = 'running' | 'paused' | 'stopped' | 'done'
