import { describe, expect, it } from 'vitest'
import {
  forceAllRowsBlankFlagged,
  mergeRows,
  policyClaimsEvidence,
  validateWorkerChunk,
} from './merge'
import {
  makeBlueprint,
  makeChunkResponse,
  makeEvidenceBlueprint,
  makePlannedRow,
  makeRegion,
  makeWorkerRow,
} from './fixtures'
import type { AnswerPolicyType, Blueprint, WorkerRow } from './types'

function chunkRowsOf(blueprint: Blueprint) {
  return blueprint.planned_rows
}

describe('validateWorkerChunk', () => {
  it('accepts a well-formed chunk and returns narrowed rows', () => {
    const blueprint = makeBlueprint()
    const rows = chunkRowsOf(blueprint)
    const result = validateWorkerChunk(makeChunkResponse(rows), rows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows.map((row) => row.id)).toEqual(['1', '2'])
      expect(result.rows[0].options).toHaveLength(4)
    }
  })

  it('tolerates a markdown-fenced JSON body', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const fenced = '```json\n' + makeChunkResponse(rows) + '\n```'
    expect(validateWorkerChunk(fenced, rows).ok).toBe(true)
  })

  it('rejects unparseable JSON', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const result = validateWorkerChunk('{"rows": [', rows)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('not valid JSON')
  })

  it('rejects a response with no rows array', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const result = validateWorkerChunk('{"answers": []}', rows)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('no "rows" array')
  })

  it('rejects an added row', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const extra = makeWorkerRow(makePlannedRow('3'))
    const body = JSON.parse(makeChunkResponse(rows))
    body.rows.push(extra)
    const result = validateWorkerChunk(JSON.stringify(body), rows)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('expected 2 rows, got 3')
  })

  it('rejects a removed row', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const body = JSON.parse(makeChunkResponse(rows))
    body.rows.pop()
    const result = validateWorkerChunk(JSON.stringify(body), rows)
    expect(result.ok).toBe(false)
  })

  it('rejects reordered rows', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const body = JSON.parse(makeChunkResponse(rows))
    body.rows.reverse()
    const result = validateWorkerChunk(JSON.stringify(body), rows)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('no additions, removals, or reordering')
    }
  })

  it('rejects a changed planner-owned field (regrouping)', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const body = JSON.parse(
      makeChunkResponse(rows, () => ({ group_id: 'worker-invented-group' })),
    )
    const result = validateWorkerChunk(JSON.stringify(body), rows)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('planner-owned field "group_id" was changed')
    }
  })

  it('rejects changed image assignments', () => {
    const rows = chunkRowsOf(makeBlueprint())
    const body = JSON.parse(
      makeChunkResponse(rows, () => ({ image_urls: ['images/made-up.jpg'] })),
    )
    const result = validateWorkerChunk(JSON.stringify(body), rows)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('planner-owned field "image_urls" was changed')
    }
  })

  it('accepts a numeric correct_index and normalizes it to a string', () => {
    const blueprint = makeEvidenceBlueprint()
    const rows = chunkRowsOf(blueprint)
    const body = JSON.parse(makeChunkResponse(rows))
    body.rows[0].correct_index = 2
    const result = validateWorkerChunk(JSON.stringify(body), rows)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rows[0].correct_index).toBe('2')
  })
})

describe('answer-policy forcing (NEVER-GUESS)', () => {
  const policyForcesBlank: AnswerPolicyType[] = ['no_answer_key', 'uncertain']

  for (const policyType of policyForcesBlank) {
    it(`policy "${policyType}" forces every answer blank even when the worker filled them`, () => {
      const blueprint = makeBlueprint()
      blueprint.document_profile.answer_policy.type = policyType
      const workerRows: WorkerRow[] = blueprint.planned_rows.map((planned) =>
        makeWorkerRow(planned, { correct_index: '1' }),
      )

      const result = mergeRows(blueprint, workerRows)

      expect(result.ok).toBe(true)
      if (result.ok) {
        for (const row of result.rows) {
          expect(row.correct_index).toBe('')
          expect(row.needs_review).toBe(policyType)
        }
      }
    })
  }

  it('an evidence policy accepts a valid worker index', () => {
    const blueprint = makeEvidenceBlueprint()
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, { correct_index: '2' }),
    )
    const result = mergeRows(blueprint, workerRows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows.map((row) => row.correct_index)).toEqual(['2', '2'])
      expect(result.rows.map((row) => row.needs_review)).toEqual(['', ''])
    }
  })

  it('an evidence policy with a blank worker answer keeps it blank and flags no_visible_answer', () => {
    const blueprint = makeEvidenceBlueprint()
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, { correct_index: '' }),
    )
    const result = mergeRows(blueprint, workerRows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const row of result.rows) {
        expect(row.correct_index).toBe('')
        expect(row.needs_review).toBe('no_visible_answer')
      }
    }
  })

  it('an out-of-range index is blanked and flagged, never clamped', () => {
    const blueprint = makeEvidenceBlueprint()
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, { correct_index: '9' }), // only 4 options
    )
    const result = mergeRows(blueprint, workerRows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const row of result.rows) {
        expect(row.correct_index).toBe('')
        expect(row.needs_review).toBe('index_out_of_range')
      }
    }
  })

  it('a non-numeric answer ("B") is blanked and flagged, never interpreted', () => {
    const blueprint = makeEvidenceBlueprint()
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, { correct_index: 'B' }),
    )
    const result = mergeRows(blueprint, workerRows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const row of result.rows) {
        expect(row.correct_index).toBe('')
        expect(row.needs_review).toBe('key_unclear')
      }
    }
  })

  it('a per-row planner blank policy (conflicting marks) wins over a filled worker answer', () => {
    const blueprint = makeEvidenceBlueprint()
    blueprint.planned_rows[0].correct_index_policy = {
      type: 'blank_conflicting_marks',
      value: '',
      needs_review: 'conflicting_marks',
    }
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, { correct_index: '1' }),
    )

    const result = mergeRows(blueprint, workerRows)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].correct_index).toBe('')
      expect(result.rows[0].needs_review).toBe('conflicting_marks')
      // The unaffected row still extracts normally.
      expect(result.rows[1].correct_index).toBe('1')
    }
  })

  it('index 0 is a real answer, never confused with blank', () => {
    const blueprint = makeEvidenceBlueprint()
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, { correct_index: '0' }),
    )
    const result = mergeRows(blueprint, workerRows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].correct_index).toBe('0')
      expect(result.rows[0].needs_review).toBe('')
    }
  })
})

describe('merge ownership', () => {
  it("the worker's needs_review is always discarded", () => {
    const blueprint = makeEvidenceBlueprint()
    const workerRows = blueprint.planned_rows.map((planned) =>
      makeWorkerRow(planned, {
        correct_index: '1',
        needs_review: 'worker_thinks_this_is_fine',
      }),
    )
    const result = mergeRows(blueprint, workerRows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const row of result.rows) {
        expect(row.needs_review).not.toContain('worker')
        expect(row.needs_review).toBe('')
      }
    }
  })

  it('planner-owned fields come from the blueprint even if the worker rows disagree', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].topic = 'Surgery'
    blueprint.planned_rows[0].image_urls = ['images/asset01.jpg']
    const workerRows = blueprint.planned_rows.map((planned) => ({
      ...makeWorkerRow(planned),
      topic: 'Something Else',
      image_urls: [],
    }))

    const result = mergeRows(blueprint, workerRows)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].topic).toBe('Surgery')
      expect(result.rows[0].image_urls).toEqual(['images/asset01.jpg'])
    }
  })

  it('row count and order follow the blueprint', () => {
    const blueprint = makeBlueprint()
    const reversed = [...blueprint.planned_rows].reverse().map((planned) => makeWorkerRow(planned))
    const result = mergeRows(blueprint, reversed)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rows.map((row) => row.id)).toEqual(['1', '2'])
  })

  it('a missing worker row fails the merge gate', () => {
    const blueprint = makeBlueprint()
    const result = mergeRows(blueprint, [makeWorkerRow(blueprint.planned_rows[0])])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('no worker row for planned row "2"')
  })

  it('a worker row outside the blueprint fails the merge gate', () => {
    const blueprint = makeBlueprint()
    const rows = [
      ...blueprint.planned_rows.map((planned) => makeWorkerRow(planned)),
      makeWorkerRow(makePlannedRow('99')),
    ]
    const result = mergeRows(blueprint, rows)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('"99" is not in the blueprint')
  })
})

describe('deterministic question assembly (§2.2)', () => {
  function caseRow(id: string) {
    return makePlannedRow(id, {
      question_assembly: {
        mode: 'case_stem_plus_question_prompt',
        final_format: '{case_stem}\n\n{question_prompt}',
      },
      regions: {
        case_stem: makeRegion(),
        question_prompt: makeRegion(),
        options: makeRegion(),
        answer_evidence: null,
      },
    })
  }

  it('strips both printed numbers and joins stem + prompt with a blank line', () => {
    const blueprint = makeBlueprint({ planned_rows: [caseRow('1')] })
    const result = mergeRows(blueprint, [
      makeWorkerRow(blueprint.planned_rows[0], {
        case_stem: '16- A 45-year-old man presents',
        question: '17- What is the next step?',
      }),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].question).toBe(
        'A 45-year-old man presents\n\nWhat is the next step?',
      )
    }
  })

  it('keeps a printed case identity ("Case 10 …") in the stem', () => {
    const blueprint = makeBlueprint({ planned_rows: [caseRow('1')] })
    const result = mergeRows(blueprint, [
      makeWorkerRow(blueprint.planned_rows[0], {
        case_stem: 'Case 10 A 4 months-old infant presented',
        question: '19) The most likely diagnosis is',
      }),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].question).toBe(
        'Case 10 A 4 months-old infant presented\n\nThe most likely diagnosis is',
      )
    }
  })

  it('degrades to the prompt alone when a case row has no stem', () => {
    const blueprint = makeBlueprint({ planned_rows: [caseRow('1')] })
    const result = mergeRows(blueprint, [
      makeWorkerRow(blueprint.planned_rows[0], {
        case_stem: '',
        question: 'Standalone prompt with no stem?',
      }),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].question).toBe('Standalone prompt with no stem?')
    }
  })

  it('assembles a legacy-format checkpoint into its original labelled shape', () => {
    // A pre-change blueprint still carries the old final_format; substitution
    // reproduces the labelled output so resumed old runs are unchanged.
    const blueprint = makeBlueprint({
      planned_rows: [
        caseRow('1'),
      ],
    })
    blueprint.planned_rows[0].question_assembly.final_format =
      'Case stem: {case_stem}\nQuestion: {question_prompt}'
    const result = mergeRows(blueprint, [
      makeWorkerRow(blueprint.planned_rows[0], {
        case_stem: 'A shared stem',
        question: 'The prompt?',
      }),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows[0].question).toBe(
        'Case stem: A shared stem\nQuestion: The prompt?',
      )
    }
  })
})

describe('wrong-declaration degrade', () => {
  it('blanks and flags every row — never wrong rows', () => {
    const blueprint = makeEvidenceBlueprint()
    const merged = mergeRows(
      blueprint,
      blueprint.planned_rows.map((planned) =>
        makeWorkerRow(planned, { correct_index: '1' }),
      ),
    )
    expect(merged.ok).toBe(true)
    if (!merged.ok) return

    const degraded = forceAllRowsBlankFlagged(merged.rows, 'wrong_declaration')

    for (const row of degraded) {
      expect(row.correct_index).toBe('')
      expect(row.needs_review).toBe('wrong_declaration')
    }
    // Content is preserved — only answers are withheld.
    expect(degraded[0].question).toBe(merged.rows[0].question)
    expect(degraded[0].options).toEqual(merged.rows[0].options)
  })
})

describe('policyClaimsEvidence', () => {
  it('is true only for the three evidence policies', () => {
    expect(policyClaimsEvidence('separate_key')).toBe(true)
    expect(policyClaimsEvidence('inline_marks')).toBe(true)
    expect(policyClaimsEvidence('mixed')).toBe(true)
    expect(policyClaimsEvidence('no_answer_key')).toBe(false)
    expect(policyClaimsEvidence('uncertain')).toBe(false)
  })
})
