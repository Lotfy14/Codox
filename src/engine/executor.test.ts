import { describe, expect, it } from 'vitest'
import { underTranscribedRowIds } from './executor'
import { makeBlueprint, makePlannedRow, makeWorkerRow } from './fixtures'

describe('underTranscribedRowIds', () => {
  it('flags an options-bearing row the worker cut to a single option', () => {
    const p1 = makePlannedRow('1')
    const p2 = makePlannedRow('2')
    const blueprint = makeBlueprint({ planned_rows: [p1, p2] })
    const rows = [
      makeWorkerRow(p1, { options: ['Age'] }),
      makeWorkerRow(p2, { options: ['A', 'B', 'C', 'D', 'E'] }),
    ]
    expect(underTranscribedRowIds(blueprint, rows)).toEqual(['1'])
  })

  it('ignores a row with no options region (not a defect)', () => {
    const p1 = makePlannedRow('1', {
      regions: {
        case_stem: null,
        question_prompt: makePlannedRow('1').regions.question_prompt,
        options: null,
        answer_evidence: null,
      },
    })
    const blueprint = makeBlueprint({ planned_rows: [p1] })
    const rows = [makeWorkerRow(p1, { options: [] })]
    expect(underTranscribedRowIds(blueprint, rows)).toEqual([])
  })

  it('leaves a genuine two-option (True/False) row alone', () => {
    const p1 = makePlannedRow('1')
    const blueprint = makeBlueprint({ planned_rows: [p1] })
    const rows = [makeWorkerRow(p1, { options: ['True', 'False'] })]
    expect(underTranscribedRowIds(blueprint, rows)).toEqual([])
  })
})
