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
import { BOX_BATCH_PROMPT, BOX_PROMPT, EVIDENCE_PROMPT, FIGURE_DETECT_PROMPT, INDEX_PROMPT } from './prompts'
import { AUDIT_PROMPT, PLANNER_PROMPT, WORKER_PROMPT } from './prompts'
import type { AuditReport, Blueprint, MergedRow, ReducedBlueprint } from './types'

/**
 * Fixed model assignments (§1.2) — no fallback, ever. Every role runs on
 * gemini-3.1-flash-lite (owner decision 2026-07-14: gemini-3.5-flash's
 * free-tier per-minute ceiling made the planner call 429 on its own; see
 * DEFAULT_GEMINI_VISION_MODEL). The engine never swaps a role's model — not on
 * a 5xx, not from a model-listing result. It retries the same model, then stops
 * honestly (see executor.test.ts). There is no second provider and no fallback
 * key (CLAUDE.md: Gemini only).
 */
export const PLANNER_MODEL = DEFAULT_GEMINI_VISION_MODEL // gemini-3.1-flash-lite
export const AUDIT_MODEL = 'gemini-3.1-flash-lite'
export const WORKER_MODEL = AUDIT_MODEL

const JSON_ONLY = 'application/json'

/** §1.11 max output tokens, per role. */
const PLANNER_MAX_TOKENS = 65_536
const WORKER_MAX_TOKENS = 32_768
const AUDIT_MAX_TOKENS = 32_768

export interface CallImage {
  mimeType: string
  base64Data: string
}

export function buildPlannerRequest(
  pages: readonly CallImage[],
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  return {
    prompt: PLANNER_PROMPT,
    images: pages,
    modelId: plannerModel,
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
  plannerModel = PLANNER_MODEL,
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
    modelId: plannerModel,
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

const REGION_SCHEMA = {
  type: 'OBJECT',
  nullable: true,
  properties: {
    page: { type: 'INTEGER' },
    box_2d: { type: 'ARRAY', items: { type: 'NUMBER' }, minItems: 4, maxItems: 4 },
    anchor: { type: 'STRING' },
  },
}

function structuredPlannerRequest(
  prompt: string,
  pages: readonly CallImage[],
  responseSchema: Record<string, unknown>,
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  return {
    prompt,
    images: pages,
    modelId: plannerModel,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: PLANNER_MAX_TOKENS,
      responseMimeType: JSON_ONLY,
      responseSchema,
    },
  }
}

export function buildIndexRequest(
  pages: readonly CallImage[],
  coreRelativePages: readonly number[],
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  const prompt = INDEX_PROMPT + '\n\nCORE PAGES: ' + JSON.stringify(coreRelativePages)
  return structuredPlannerRequest(prompt, pages, {
    type: 'OBJECT',
    properties: {
      questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        ref: { type: 'STRING' }, printed_label: { type: 'STRING' }, owner_page: { type: 'INTEGER' },
        source_pages: { type: 'ARRAY', items: { type: 'INTEGER' } }, anchor: { type: 'STRING' },
        options_present: { type: 'BOOLEAN' }, case_stem_key: { type: 'STRING', nullable: true },
        section_hint: { type: 'STRING' }, visible_year: { type: 'STRING' },
        answer_present: { type: 'BOOLEAN' },
      }, required: ['ref','printed_label','owner_page','source_pages','anchor','options_present','case_stem_key','section_hint','visible_year','answer_present'] } },
      pages: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        page: { type: 'INTEGER' }, contains_question_start: { type: 'BOOLEAN' },
        first_printed_label: { type: 'STRING' }, last_printed_label: { type: 'STRING' }, section_hint: { type: 'STRING' },
      }, required: ['page','contains_question_start','first_printed_label','last_printed_label','section_hint'] } },
    },
    required: ['questions', 'pages'],
  }, plannerModel)
}

export function buildEvidenceRequest(
  pages: readonly CallImage[], refs: readonly { ref: string; printedLabel: string; section: string }[],
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  const prompt = EVIDENCE_PROMPT + '\n\nQUESTION REFERENCES:\n' + JSON.stringify(refs)
  return structuredPlannerRequest(prompt, pages, {
    type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: ['no_answer_key','separate_key','inline_marks','mixed','uncertain'] },
      marking_style: { type: 'STRING' },
      evidence: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        ref: { type: 'STRING' }, state: { type: 'STRING', enum: ['none','inline','separate','ambiguous','illegible'] },
        region: REGION_SCHEMA,
      }, required: ['ref','state','region'] } },
    }, required: ['type','marking_style','evidence'],
  }, plannerModel)
}

export function buildFigureDetectRequest(
  pages: readonly CallImage[], refs: readonly { ref: string; ownerPage: number }[],
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  return structuredPlannerRequest(FIGURE_DETECT_PROMPT + '\n\nQUESTION REFERENCES:\n' + JSON.stringify(refs), pages, {
    type: 'OBJECT', properties: {
      figures: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        page: { type: 'INTEGER' }, linked_refs: { type: 'ARRAY', items: { type: 'STRING' } }, anchor: { type: 'STRING' },
      }, required: ['page','linked_refs','anchor'] } },
    }, required: ['figures'],
  }, plannerModel)
}

export interface BoxTaskRef {
  ref: string;
  printedLabel: string;
  anchor: string;
  optionsPresent: boolean;
  hasCase: boolean;
  hasInlineEvidence: boolean;
}

const BOX_RESPONSE_SCHEMA = {
  type: 'OBJECT', properties: {
    questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      ref: { type: 'STRING' }, question: REGION_SCHEMA, options: REGION_SCHEMA,
      case_stem: REGION_SCHEMA, inline_evidence: REGION_SCHEMA,
    }, required: ['ref','question','options','case_stem','inline_evidence'] } },
    figures: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      page: { type: 'INTEGER' }, linked_refs: { type: 'ARRAY', items: { type: 'STRING' } },
      box_2d: { type: 'ARRAY', items: { type: 'NUMBER' }, minItems: 4, maxItems: 4 }, anchor: { type: 'STRING' },
    }, required: ['page','linked_refs','box_2d','anchor'] } },
  }, required: ['questions','figures'],
}

export function buildBoxRequest(
  pages: readonly CallImage[],
  refs: readonly BoxTaskRef[],
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  return structuredPlannerRequest(
    BOX_PROMPT + '\n\nPAGE TASKS:\n' + JSON.stringify(refs),
    pages, BOX_RESPONSE_SCHEMA, plannerModel,
  )
}

/**
 * Several pages in one BOX call (Customize's "Pages per box request" > 1,
 * owner-approved 2026-07-17). Each ref carries the 1-based image number of
 * the page it lives on; the response's figure pages are those same relative
 * numbers, mapped back to absolute pages by the executor.
 */
export function buildBoxBatchRequest(
  pages: readonly CallImage[],
  refs: readonly (BoxTaskRef & { page: number })[],
  plannerModel = PLANNER_MODEL,
): VisionRequest {
  return structuredPlannerRequest(
    BOX_BATCH_PROMPT + '\n\nPAGE TASKS:\n' + JSON.stringify(refs),
    pages, BOX_RESPONSE_SCHEMA, plannerModel,
  )
}
