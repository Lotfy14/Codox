/**
 * Blueprint validation (§1.6, deterministic, pre-worker), the code-owned
 * asset-path rewrite, the reduced-blueprint builder (§1.9), and chunking.
 * All pure: data in, data out.
 */
import { isBox2d } from './boxes'
import { isRecord, isStringArray, parseModelJson } from './json'
import {
  ANSWER_POLICY_TYPES,
  CSV_SCHEMA,
  type AnswerPolicyType,
  type Blueprint,
  type BlueprintAsset,
  type PlannedRow,
  type ReducedBlueprint,
  type Region,
} from './types'

/** §1.10's exact per-mode formats, as the planner prompt pins them. */
const PLAIN_FORMAT = '{question_prompt}'
const CASE_FORMAT = 'Case stem: {case_stem}\nQuestion: {question_prompt}'

export type BlueprintValidation =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; errors: string[] }

function narrowRegion(
  value: unknown,
  where: string,
  renderedPages: ReadonlySet<number>,
  errors: string[],
): Region | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) {
    errors.push(`${where}: region must be an object or null`)
    return null
  }
  if (typeof value.page !== 'number' || !renderedPages.has(value.page)) {
    errors.push(`${where}: page reference is not in the rendered page set`)
    return null
  }
  if (!isBox2d(value.box_2d)) {
    errors.push(`${where}: box_2d must be a numeric [ymin, xmin, ymax, xmax]`)
    return null
  }
  return {
    page: value.page,
    box_2d: value.box_2d,
    anchor: typeof value.anchor === 'string' ? value.anchor : undefined,
  }
}

function narrowAsset(
  value: unknown,
  index: number,
  renderedPages: ReadonlySet<number>,
  errors: string[],
): BlueprintAsset | undefined {
  const where = `assets[${index}]`
  if (!isRecord(value)) {
    errors.push(`${where}: must be an object`)
    return undefined
  }
  const before = errors.length
  if (typeof value.asset_id !== 'string' || value.asset_id === '') {
    errors.push(`${where}: asset_id must be a non-empty string`)
  }
  if (typeof value.page !== 'number' || !renderedPages.has(value.page)) {
    errors.push(`${where}: page reference is not in the rendered page set`)
  }
  if (!isBox2d(value.box_2d)) {
    errors.push(`${where}: box_2d must be a numeric [ymin, xmin, ymax, xmax]`)
  }
  if (typeof value.output_path !== 'string' || value.output_path === '') {
    errors.push(`${where}: output_path must be a non-empty string`)
  }
  if (!isStringArray(value.linked_row_ids)) {
    errors.push(`${where}: linked_row_ids must be an array of strings`)
  }
  if (errors.length > before) return undefined
  return {
    asset_id: value.asset_id as string,
    kind: typeof value.kind === 'string' ? value.kind : '',
    page: value.page as number,
    box_2d: value.box_2d as BlueprintAsset['box_2d'],
    output_path: value.output_path as string,
    linked_group_id:
      typeof value.linked_group_id === 'string' ? value.linked_group_id : '',
    linked_row_ids: value.linked_row_ids as string[],
    anchor: typeof value.anchor === 'string' ? value.anchor : '',
  }
}

function narrowRow(
  value: unknown,
  index: number,
  renderedPages: ReadonlySet<number>,
  errors: string[],
): PlannedRow | undefined {
  const where = `planned_rows[${index}]`
  if (!isRecord(value)) {
    errors.push(`${where}: must be an object`)
    return undefined
  }
  const before = errors.length

  // §1.6: every row has all planner-owned fields.
  for (const field of ['id', 'group_id', 'topic', 'subtopic', 'year']) {
    if (typeof value[field] !== 'string') {
      errors.push(`${where}: planner-owned field "${field}" must be a string`)
    }
  }
  if (typeof value.id === 'string' && value.id === '') {
    errors.push(`${where}: id must be non-empty`)
  }
  // §1.6: group IDs are non-empty and stable.
  if (typeof value.group_id === 'string' && value.group_id === '') {
    errors.push(`${where}: group_id must be non-empty`)
  }
  if (!isStringArray(value.image_urls)) {
    errors.push(`${where}: image_urls must be an array of strings`)
  }

  const assembly = value.question_assembly
  let mode: PlannedRow['question_assembly']['mode'] = 'plain_question_prompt'
  let finalFormat = ''
  if (
    !isRecord(assembly) ||
    (assembly.mode !== 'plain_question_prompt' &&
      assembly.mode !== 'case_stem_plus_question_prompt') ||
    typeof assembly.final_format !== 'string'
  ) {
    errors.push(`${where}: question_assembly.mode must be plain_question_prompt or case_stem_plus_question_prompt`)
  } else {
    mode = assembly.mode
    finalFormat = assembly.final_format
    const expected = mode === 'plain_question_prompt' ? PLAIN_FORMAT : CASE_FORMAT
    if (finalFormat !== expected) {
      errors.push(`${where}: final_format must be ${JSON.stringify(expected)} for mode ${mode}`)
    }
  }

  const regionsRaw = isRecord(value.regions) ? value.regions : undefined
  if (regionsRaw === undefined) {
    errors.push(`${where}: regions must be an object`)
  }
  const regions = {
    case_stem: narrowRegion(regionsRaw?.case_stem, `${where}.regions.case_stem`, renderedPages, errors),
    question_prompt: narrowRegion(regionsRaw?.question_prompt, `${where}.regions.question_prompt`, renderedPages, errors),
    options: narrowRegion(regionsRaw?.options, `${where}.regions.options`, renderedPages, errors),
    answer_evidence: narrowRegion(regionsRaw?.answer_evidence, `${where}.regions.answer_evidence`, renderedPages, errors),
  }
  // §1.6: enough regions for worker transcription.
  if (regionsRaw !== undefined && regions.question_prompt === null) {
    errors.push(`${where}: a non-null question_prompt region is required`)
  }
  // §1.6/§1.10: a case-mode row needs a real case stem region.
  if (mode === 'case_stem_plus_question_prompt' && regions.case_stem === null) {
    errors.push(`${where}: case_stem_plus_question_prompt requires a non-null case_stem region`)
  }

  const policy = value.correct_index_policy
  if (
    !isRecord(policy) ||
    typeof policy.type !== 'string' ||
    typeof policy.value !== 'string' ||
    typeof policy.needs_review !== 'string'
  ) {
    errors.push(`${where}: correct_index_policy must have string type, value, needs_review`)
  }

  const task = value.worker_task
  if (!isRecord(task)) {
    errors.push(`${where}: worker_task must be an object`)
  }

  if (errors.length > before) return undefined
  const policyRecord = policy as Record<string, string>
  const taskRecord = task as Record<string, unknown>
  return {
    id: value.id as string,
    group_id: value.group_id as string,
    topic: value.topic as string,
    subtopic: value.subtopic as string,
    year: value.year as string,
    question_assembly: { mode, final_format: finalFormat },
    regions,
    image_urls: value.image_urls as string[],
    correct_index_policy: {
      type: policyRecord.type,
      value: policyRecord.value,
      needs_review: policyRecord.needs_review,
    },
    worker_task: {
      case_stem_required: taskRecord.case_stem_required === true,
      read_regions_only: taskRecord.read_regions_only === true,
      must_follow_planner_structure:
        taskRecord.must_follow_planner_structure === true,
    },
  }
}

/** True when the per-row planner policy already forces a blank answer. */
function rowForcesBlank(row: PlannedRow): boolean {
  return (
    row.correct_index_policy.needs_review !== '' ||
    row.correct_index_policy.type.startsWith('blank')
  )
}

/**
 * The counts a raw planner response DECLARES, without validating anything
 * else. `question_count` is document evidence — what the planner says it SAW.
 */
export function readDeclaredCounts(responseText: string): {
  questionCount?: number
  rowCount?: number
} {
  const parsed = parseModelJson(responseText)
  if (parsed.error !== undefined || !isRecord(parsed.value)) return {}
  const raw = parsed.value
  const profile = isRecord(raw.document_profile) ? raw.document_profile : undefined
  return {
    questionCount:
      typeof profile?.question_count === 'number'
        ? profile.question_count
        : undefined,
    rowCount: Array.isArray(raw.planned_rows) ? raw.planned_rows.length : undefined,
  }
}

/**
 * True when the planner counted more questions than it emitted rows for.
 *
 * A SHORTFALL is the dangerous direction, and this is the only guard on it.
 * It is the failure that silently shipped a 3-row CSV for a 108-question exam:
 * the planner reported `question_count: 108` with 3 rows. A shortfall must
 * never be repaired away — the cheapest way for a model to make the numbers
 * agree is to rewrite the count down to 3, destroying the only evidence that
 * anything was wrong. The caller splits the page window and re-plans instead.
 *
 * The OTHER direction is harmless, which is why `validateBlueprint` has no
 * count-equality rule: a planner that emits 17 fully-specified rows and writes
 * `question_count: 15` next to them has done its job — the rows are the
 * product, the count is a profile number it guessed at. Rejecting that threw
 * away 17 good rows and stopped a real 30-page run with
 * `planner_invalid_after_repair`. Code owns the count (see `validateBlueprint`
 * and `stitchBlueprints`, which both emit `rows.length`).
 */
export function isUnderExtracted(responseText: string): boolean {
  const { questionCount, rowCount } = readDeclaredCounts(responseText)
  return (
    questionCount !== undefined &&
    rowCount !== undefined &&
    rowCount < questionCount
  )
}

/**
 * The §1.6 rule list over a raw planner response. `renderedPages` is the
 * set of 1-based page numbers that actually rendered.
 *
 * `document_profile.question_count` must be a number (the contract shape), but
 * it is never compared to the row count: the shortfall direction belongs to
 * `isUnderExtracted`, which every caller runs BEFORE this, and the surplus
 * direction is not an error. The emitted profile carries `rows.length`.
 */
export function validateBlueprint(
  responseText: string,
  renderedPages: ReadonlySet<number>,
): BlueprintValidation {
  const parsed = parseModelJson(responseText)
  if (parsed.error !== undefined) {
    return { ok: false, errors: [`blueprint is not valid JSON: ${parsed.error}`] }
  }
  const raw = parsed.value
  if (!isRecord(raw)) {
    return { ok: false, errors: ['blueprint must be a JSON object'] }
  }
  const errors: string[] = []

  // csv_schema equals exactly the 10-column contract list.
  if (
    !isStringArray(raw.csv_schema) ||
    raw.csv_schema.length !== CSV_SCHEMA.length ||
    raw.csv_schema.some((col, i) => col !== CSV_SCHEMA[i])
  ) {
    errors.push(`csv_schema must equal exactly [${CSV_SCHEMA.join(', ')}]`)
  }

  // Document profile + answer policy.
  const profile = raw.document_profile
  let policyType: AnswerPolicyType | undefined
  if (!isRecord(profile)) {
    errors.push('document_profile must be an object')
  } else {
    if (typeof profile.question_count !== 'number') {
      errors.push('document_profile.question_count must be a number')
    }
    const policy = profile.answer_policy
    if (
      !isRecord(policy) ||
      typeof policy.type !== 'string' ||
      !(ANSWER_POLICY_TYPES as readonly string[]).includes(policy.type)
    ) {
      errors.push(`answer_policy.type must be one of ${ANSWER_POLICY_TYPES.join(', ')}`)
    } else {
      policyType = policy.type as AnswerPolicyType
    }
  }

  // Assets.
  const assets: BlueprintAsset[] = []
  if (!Array.isArray(raw.assets)) {
    errors.push('assets must be an array')
  } else {
    raw.assets.forEach((value, index) => {
      const asset = narrowAsset(value, index, renderedPages, errors)
      if (asset !== undefined) assets.push(asset)
    })
  }

  // Planned rows.
  const rows: PlannedRow[] = []
  if (!Array.isArray(raw.planned_rows)) {
    errors.push('planned_rows must be an array')
  } else {
    raw.planned_rows.forEach((value, index) => {
      const row = narrowRow(value, index, renderedPages, errors)
      if (row !== undefined) rows.push(row)
    })
  }

  // Row IDs unique.
  const seenIds = new Set<string>()
  for (const row of rows) {
    if (seenIds.has(row.id)) errors.push(`duplicate row id "${row.id}"`)
    seenIds.add(row.id)
  }

  // Every planned image path has a source bbox: each row image_url must
  // name an asset (assets always carry a box once narrowed).
  const assetPaths = new Set(assets.map((asset) => asset.output_path))
  for (const row of rows) {
    for (const url of row.image_urls) {
      if (!assetPaths.has(url)) {
        errors.push(`row "${row.id}": image_urls entry "${url}" names no asset`)
      }
    }
  }

  // Evidence-typed policy → every governed row has answer evidence.
  if (policyType !== undefined && ['separate_key', 'inline_marks', 'mixed'].includes(policyType)) {
    for (const row of rows) {
      if (!rowForcesBlank(row) && row.regions.answer_evidence === null) {
        errors.push(
          `row "${row.id}": answer policy "${policyType}" requires a non-null answer_evidence region`,
        )
      }
    }
  }

  // Worker constraints present and forbidding all structural changes.
  const constraints = raw.worker_constraints
  const constraintKeys = [
    'may_add_rows',
    'may_remove_rows',
    'may_change_grouping',
    'may_change_image_assignments',
    'may_change_answer_policy',
    'may_flag_planner_disagreement',
  ] as const
  if (!isRecord(constraints)) {
    errors.push('worker_constraints must be an object')
  } else {
    for (const key of constraintKeys) {
      if (constraints[key] !== false) {
        errors.push(`worker_constraints.${key} must be false`)
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  const profileRecord = profile as Record<string, unknown>
  const policyRecord = profileRecord.answer_policy as Record<string, unknown>
  return {
    ok: true,
    blueprint: {
      csv_schema: raw.csv_schema as string[],
      document_profile: {
        page_count:
          typeof profileRecord.page_count === 'number'
            ? profileRecord.page_count
            : renderedPages.size,
        // Deterministic truth: the rows we actually carry, never the number the
        // planner wrote next to them (see the count-rule note above).
        question_count: rows.length,
        group_count:
          typeof profileRecord.group_count === 'number'
            ? profileRecord.group_count
            : 0,
        question_pages: Array.isArray(profileRecord.question_pages)
          ? profileRecord.question_pages.filter(
              (page): page is number => typeof page === 'number',
            )
          : [],
        answer_policy: {
          type: policyType as AnswerPolicyType,
          answer_key_present: policyRecord.answer_key_present === true,
          marking_style:
            typeof policyRecord.marking_style === 'string'
              ? policyRecord.marking_style
              : '',
          worker_rule:
            typeof policyRecord.worker_rule === 'string'
              ? policyRecord.worker_rule
              : '',
        },
      },
      assets,
      planned_rows: rows,
      worker_constraints: {
        may_add_rows: false,
        may_remove_rows: false,
        may_change_grouping: false,
        may_change_image_assignments: false,
        may_change_answer_policy: false,
        may_flag_planner_disagreement: false,
      },
    },
  }
}

/**
 * Code owns paths (§1.4): actual crops are JPEG, so every asset path and
 * row image_url gets its extension deterministically rewritten to `.jpg`
 * (the planner example suggests `.png`; deterministic-code decision).
 */
export function assetJpegPath(path: string): string {
  return path.replace(/\.[A-Za-z0-9]+$/, '.jpg')
}

export function rewriteAssetPaths(blueprint: Blueprint): Blueprint {
  return {
    ...blueprint,
    assets: blueprint.assets.map((asset) => ({
      ...asset,
      output_path: assetJpegPath(asset.output_path),
    })),
    planned_rows: blueprint.planned_rows.map((row) => ({
      ...row,
      image_urls: row.image_urls.map(assetJpegPath),
    })),
  }
}

/** Splits planned rows into chunks of `size` (default 10, §1.9). */
export function chunkPlannedRows(
  blueprint: Blueprint,
  size = 10,
): PlannedRow[][] {
  const chunks: PlannedRow[][] = []
  for (let start = 0; start < blueprint.planned_rows.length; start += size) {
    chunks.push(blueprint.planned_rows.slice(start, start + size))
  }
  return chunks
}

/**
 * The reduced blueprint one chunk receives (§1.3 step 5): schema, profile,
 * constraints, ONLY the chunk's rows plus the assets those rows reference.
 */
export function buildReducedBlueprint(
  blueprint: Blueprint,
  chunkRows: readonly PlannedRow[],
): ReducedBlueprint {
  const rowIds = new Set(chunkRows.map((row) => row.id))
  const referencedPaths = new Set(chunkRows.flatMap((row) => row.image_urls))
  return {
    csv_schema: blueprint.csv_schema,
    document_profile: blueprint.document_profile,
    worker_constraints: blueprint.worker_constraints,
    planned_rows: [...chunkRows],
    assets: blueprint.assets.filter(
      (asset) =>
        referencedPaths.has(asset.output_path) ||
        asset.linked_row_ids.some((id) => rowIds.has(id)),
    ),
  }
}

/**
 * The 1-based page numbers a chunk's rows and assets reference — the full
 * page images the worker call must include (§1.3 step 5).
 */
export function chunkPages(reduced: ReducedBlueprint): number[] {
  const pages = new Set<number>()
  for (const row of reduced.planned_rows) {
    for (const page of row.source_pages ?? []) {
      pages.add(page)
    }
    for (const region of Object.values(row.regions)) {
      if (region !== null) pages.add(region.page)
    }
  }
  for (const asset of reduced.assets) pages.add(asset.page)
  return [...pages].sort((a, b) => a - b)
}
