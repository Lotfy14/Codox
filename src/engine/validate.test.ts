import { describe, expect, it } from 'vitest'
import { parseAuditReport, validateFinalRows } from './validate'
import { makeBlueprint, makePlannedRow } from './fixtures'
import type { MergedRow } from './types'

function makeMergedRow(id: string, overrides: Partial<MergedRow> = {}): MergedRow {
  return {
    id,
    group_id: `group${id}`,
    topic: '',
    subtopic: '',
    year: '',
    question: `Question ${id}?`,
    options: ['A', 'B', 'C', 'D'],
    correct_index: '',
    image_urls: [],
    needs_review: 'no_answer_key',
    ...overrides,
  }
}

const NO_CROPS = new Set<string>()

describe('validateFinalRows', () => {
  it('passes clean rows', () => {
    const blueprint = makeBlueprint()
    const rows = [makeMergedRow('1'), makeMergedRow('2')]
    expect(validateFinalRows(rows, blueprint, NO_CROPS)).toEqual({
      ok: true,
      errors: [],
    })
  })

  it('fails when the row count does not match the blueprint', () => {
    const blueprint = makeBlueprint()
    const result = validateFinalRows([makeMergedRow('1')], blueprint, NO_CROPS)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('row count 1')
  })

  it('fails an unflagged row with empty question text', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { question: '', needs_review: '' }),
      makeMergedRow('2'),
    ]
    const result = validateFinalRows(rows, blueprint, NO_CROPS)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('empty question on an unflagged row')
  })

  it('allows an empty question when the row is explicitly flagged', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { question: '', needs_review: 'mark_illegible' }),
      makeMergedRow('2'),
    ]
    expect(validateFinalRows(rows, blueprint, NO_CROPS).ok).toBe(true)
  })

  it('fails an unflagged MCQ row with no options', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { options: [], needs_review: '' }),
      makeMergedRow('2'),
    ]
    const result = validateFinalRows(rows, blueprint, NO_CROPS)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('MCQ row has no options')
  })

  it('fails a correct_index that is out of range for its options', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { correct_index: '4', needs_review: '' }), // 4 options → 0..3
      makeMergedRow('2'),
    ]
    const result = validateFinalRows(rows, blueprint, NO_CROPS)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('out of range')
  })

  it('accepts index 0 and the last valid index', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { correct_index: '0', needs_review: '' }),
      makeMergedRow('2', { correct_index: '3', needs_review: '' }),
    ]
    expect(validateFinalRows(rows, blueprint, NO_CROPS).ok).toBe(true)
  })

  it('fails a row whose image was never produced', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { image_urls: ['images/asset01.jpg'] }),
      makeMergedRow('2'),
    ]
    const result = validateFinalRows(rows, blueprint, NO_CROPS)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('was not produced')
  })

  it('passes when the referenced crop was produced', () => {
    const blueprint = makeBlueprint()
    const rows = [
      makeMergedRow('1', { image_urls: ['images/asset01.jpg'] }),
      makeMergedRow('2'),
    ]
    const crops = new Set(['images/asset01.jpg'])
    expect(validateFinalRows(rows, blueprint, crops).ok).toBe(true)
  })

  it('does not require options on a non-MCQ row (no options region planned)', () => {
    const blueprint = makeBlueprint({
      planned_rows: [
        makePlannedRow('1', {
          regions: {
            case_stem: null,
            question_prompt: { page: 1, box_2d: [0, 0, 100, 100], anchor: 'a' },
            options: null,
            answer_evidence: null,
          },
        }),
      ],
    })
    blueprint.document_profile.question_count = 1
    const rows = [makeMergedRow('1', { options: [], needs_review: '' })]
    expect(validateFinalRows(rows, blueprint, NO_CROPS).ok).toBe(true)
  })
})

describe('parseAuditReport', () => {
  const good = {
    audit_pass: true,
    risk_class: 'safe_to_import',
    failed_rows: [],
    global_failures: [],
    answer_policy_violations: [],
    crop_failures: [],
    notes: ['looks fine'],
  }

  it('parses a well-formed audit report', () => {
    const result = parseAuditReport(JSON.stringify(good))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.report.audit_pass).toBe(true)
      expect(result.report.risk_class).toBe('safe_to_import')
      expect(result.report.notes).toEqual(['looks fine'])
    }
  })

  it('parses a failing report with row-level failures', () => {
    const result = parseAuditReport(
      JSON.stringify({
        ...good,
        audit_pass: false,
        risk_class: 'not_safe_to_import',
        failed_rows: [{ id: '3', field: 'options', reason: 'text mismatch' }],
        global_failures: ['row count differs'],
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.report.audit_pass).toBe(false)
      expect(result.report.failed_rows[0].id).toBe('3')
      expect(result.report.global_failures).toEqual(['row count differs'])
    }
  })

  it('never infers a pass from an unparseable audit response', () => {
    const result = parseAuditReport('the audit model rambled in prose')
    expect(result.ok).toBe(false)
  })

  it('rejects a report missing audit_pass or with an unknown risk_class', () => {
    const noPass = parseAuditReport(
      JSON.stringify({ ...good, audit_pass: undefined }),
    )
    expect(noPass.ok).toBe(false)

    const badRisk = parseAuditReport(
      JSON.stringify({ ...good, risk_class: 'could_not_audit' }),
    )
    expect(badRisk.ok).toBe(false)
    if (!badRisk.ok) {
      expect(badRisk.errors.join(' ')).toContain('risk_class must be')
    }
  })
})
