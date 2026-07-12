/**
 * Final row validation (§1.3 step 7, pure) and the audit-response gate
 * (§1.3 step 8). A failure here never goes back to any model — the
 * executor still writes the CSV artifact but marks the run
 * `not_safe_to_import`.
 */
import { isRecord, parseModelJson } from './json'
import type { AuditReport, Blueprint, MergedRow } from './types'

export interface FinalValidation {
  ok: boolean
  errors: string[]
}

/**
 * @param rows           merged + normalized rows, blueprint order
 * @param blueprint      the validated blueprint (identifies MCQ rows)
 * @param producedCrops  relative paths of crops actually produced
 */
export function validateFinalRows(
  rows: readonly MergedRow[],
  blueprint: Blueprint,
  producedCrops: ReadonlySet<string>,
): FinalValidation {
  const errors: string[] = []
  const plannedById = new Map(
    blueprint.planned_rows.map((row) => [row.id, row]),
  )

  if (rows.length !== blueprint.planned_rows.length) {
    errors.push(
      `row count ${rows.length} does not match the blueprint's ${blueprint.planned_rows.length}`,
    )
  }

  for (const row of rows) {
    const planned = plannedById.get(row.id)
    if (planned === undefined) {
      errors.push(`row "${row.id}" is not in the blueprint`)
      continue
    }
    const flagged = row.needs_review !== ''

    // Required text fields non-empty unless the row is explicitly flagged.
    if (row.question.trim() === '' && !flagged) {
      errors.push(`row "${row.id}": empty question on an unflagged row`)
    }
    // Options present for MCQ rows (the planner gave an options region).
    if (
      planned.regions.options !== null &&
      row.options.length === 0 &&
      !flagged
    ) {
      errors.push(`row "${row.id}": MCQ row has no options`)
    }

    // correct_index blank or a valid 0-based index into this row's options.
    if (row.correct_index !== '') {
      if (!/^\d+$/.test(row.correct_index)) {
        errors.push(`row "${row.id}": correct_index "${row.correct_index}" is not an integer`)
      } else {
        const index = Number.parseInt(row.correct_index, 10)
        if (index >= row.options.length) {
          errors.push(`row "${row.id}": correct_index ${index} is out of range for ${row.options.length} options`)
        }
      }
    }

    // Every image_urls path names a crop that was actually produced.
    for (const url of row.image_urls) {
      if (!producedCrops.has(url)) {
        errors.push(`row "${row.id}": image "${url}" was not produced`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

export type AuditParse =
  | { ok: true; report: AuditReport }
  | { ok: false; errors: string[] }

/**
 * Audit gate (§1.3 step 8): the response must parse and contain
 * `audit_pass`, `failed_rows`, `global_failures`, `risk_class`. A parse
 * failure means `audit_unavailable` for the caller — NEVER an inferred
 * pass.
 */
export function parseAuditReport(responseText: string): AuditParse {
  const parsed = parseModelJson(responseText)
  if (parsed.error !== undefined) {
    return { ok: false, errors: [`audit response is not valid JSON: ${parsed.error}`] }
  }
  const raw = parsed.value
  if (!isRecord(raw)) {
    return { ok: false, errors: ['audit response must be a JSON object'] }
  }
  const errors: string[] = []
  if (typeof raw.audit_pass !== 'boolean') {
    errors.push('audit_pass must be a boolean')
  }
  if (raw.risk_class !== 'safe_to_import' && raw.risk_class !== 'not_safe_to_import') {
    errors.push('risk_class must be safe_to_import or not_safe_to_import')
  }
  if (!Array.isArray(raw.failed_rows)) errors.push('failed_rows must be an array')
  if (!Array.isArray(raw.global_failures)) errors.push('global_failures must be an array')
  if (errors.length > 0) return { ok: false, errors }

  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      : []
  return {
    ok: true,
    report: {
      audit_pass: raw.audit_pass as boolean,
      risk_class: raw.risk_class as AuditReport['risk_class'],
      failed_rows: (raw.failed_rows as unknown[]).flatMap((value) =>
        isRecord(value)
          ? [
              {
                id: typeof value.id === 'string' ? value.id : String(value.id ?? ''),
                field: typeof value.field === 'string' ? value.field : '',
                reason: typeof value.reason === 'string' ? value.reason : '',
              },
            ]
          : [],
      ),
      global_failures: strings(raw.global_failures),
      answer_policy_violations: strings(raw.answer_policy_violations),
      crop_failures: strings(raw.crop_failures),
      notes: strings(raw.notes),
    },
  }
}
