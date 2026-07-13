/**
 * Call builders: engine step → `VisionRequest` for the controller. The
 * engine never touches the adapter and never sees a key.
 *
 * Runtime parameters are pinned by CODOX_MIGRATION §1.11 (temperature 0,
 * per-role max output tokens, JSON-only responses). Prompts go in first,
 * then the images — exactly the order §2's usage notes specify.
 */
import { DEFAULT_GEMINI_VISION_MODEL } from '../providers/gemini'
import type { VisionRequest } from '../providers/types'
import { AUDIT_PROMPT, PLANNER_PROMPT, WORKER_PROMPT } from './prompts'
import type { AuditReport, Blueprint, MergedRow, ReducedBlueprint } from './types'

/**
 * Model assignments (§1.2, availability-checked at runtime by
 * `resolveWorkerModel`). The design-doc worker name `gemma-4-31b-vision`
 * is an unverified API ID — resolved against `GET /models`, never
 * silently aliased.
 */
export const PLANNER_MODEL = DEFAULT_GEMINI_VISION_MODEL // gemini-3.5-flash
export const AUDIT_MODEL = 'gemini-3.1-flash-lite'
export const INTENDED_WORKER_MODEL = 'gemini-3.1-flash-lite'
/** Recorded fallback when the intended worker ID does not exist (§1.2). */
export const WORKER_FALLBACK_MODEL = 'gemma-4-31b-vision'

const JSON_ONLY = 'application/json'

/** §1.11 max output tokens, per role. */
const PLANNER_MAX_TOKENS = 65_536
const WORKER_MAX_TOKENS = 32_768
const AUDIT_MAX_TOKENS = 32_768

export interface CallImage {
  mimeType: string
  base64Data: string
}

export function buildPlannerRequest(pages: readonly CallImage[]): VisionRequest {
  return {
    prompt: PLANNER_PROMPT,
    images: pages,
    modelId: PLANNER_MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: PLANNER_MAX_TOKENS,
      responseMimeType: JSON_ONLY,
    },
  }
}

/**
 * The one repair round (§1.3 step 3): the same planner model, the original
 * pages, the invalid blueprint, and the validation errors. The prompt
 * itself is unchanged — the repair context is appended after it, so the
 * migrated prompt text stays byte-identical.
 */
export function buildPlannerRepairRequest(
  pages: readonly CallImage[],
  invalidBlueprint: string,
  errors: readonly string[],
): VisionRequest {
  const repairContext = [
    '',
    'The blueprint below failed deterministic validation. Return a corrected',
    'blueprint in the same JSON shape. Fix only what the errors identify.',
    '',
    'VALIDATION ERRORS:',
    ...errors.map((error) => `- ${error}`),
    '',
    'INVALID BLUEPRINT:',
    invalidBlueprint,
  ].join('\n')
  return {
    prompt: `${PLANNER_PROMPT}\n${repairContext}`,
    images: pages,
    modelId: PLANNER_MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: PLANNER_MAX_TOKENS,
      responseMimeType: JSON_ONLY,
    },
  }
}

/**
 * One worker chunk (§1.3 step 5): the prompt, then the chunk package JSON,
 * then the referenced page images and crops. `previousError` carries the
 * validation error on the single permitted retry.
 */
export function buildWorkerRequest(
  reduced: ReducedBlueprint,
  images: readonly CallImage[],
  workerModel: string,
  previousError?: string,
): VisionRequest {
  const parts = [WORKER_PROMPT, '', 'CHUNK PACKAGE:', JSON.stringify(reduced)]
  if (previousError !== undefined) {
    parts.push(
      '',
      'Your previous response failed validation with this error. Return a',
      'corrected response in the same JSON shape.',
      '',
      `VALIDATION ERROR: ${previousError}`,
    )
  }
  return {
    prompt: parts.join('\n'),
    images,
    modelId: workerModel,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: WORKER_MAX_TOKENS,
      responseMimeType: JSON_ONLY,
    },
  }
}

/**
 * The read-only audit (§1.3 step 8): rendered pages + validated blueprint
 * + crops + merged rows.
 */
export function buildAuditRequest(
  blueprint: Blueprint,
  rows: readonly MergedRow[],
  images: readonly CallImage[],
): VisionRequest {
  const prompt = [
    AUDIT_PROMPT,
    '',
    'BLUEPRINT:',
    JSON.stringify(blueprint),
    '',
    'MERGED ROWS:',
    JSON.stringify({ rows }),
  ].join('\n')
  return {
    prompt,
    images,
    modelId: AUDIT_MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: AUDIT_MAX_TOKENS,
      responseMimeType: JSON_ONLY,
    },
  }
}

/** Gemini reports truncation as MAX_TOKENS; §1.3 gates fail on it. */
export function wasTruncated(finishReason: string | undefined): boolean {
  return finishReason === 'MAX_TOKENS'
}

/** An audit report that is a real fail, used when the audit is unavailable. */
export function auditUnavailableReport(reason: string): AuditReport {
  return {
    audit_pass: false,
    risk_class: 'not_safe_to_import',
    failed_rows: [],
    global_failures: [`audit_unavailable: ${reason}`],
    answer_policy_violations: [],
    crop_failures: [],
    notes: [],
  }
}
