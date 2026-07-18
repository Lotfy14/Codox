import { describe, expect, it } from 'vitest'
import { placeholderWorkerRow, underTranscribedRowIds } from './executor'
import { mergeRows, validateWorkerChunk } from './merge'
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

describe('placeholderWorkerRow', () => {
  it('echoes planner-owned fields and blanks everything the worker owns', () => {
    const planned = makePlannedRow('7', { image_urls: ['crops/q7.jpg'] })
    expect(placeholderWorkerRow(planned)).toEqual({
      id: '7',
      group_id: 'group7',
      topic: '',
      subtopic: '',
      year: '',
      case_stem: '',
      question: '',
      options: [],
      correct_index: '',
      image_urls: ['crops/q7.jpg'],
      needs_review: '',
    })
  })

  it('serialized into a chunk-response artifact, it replays through the resume gate', () => {
    // The split path checkpoints its assembled outcome as {"rows":[...]};
    // resume must accept that artifact or the split would be re-spent.
    const p1 = makePlannedRow('1')
    const p2 = makePlannedRow('2')
    const text = JSON.stringify({
      rows: [makeWorkerRow(p1), placeholderWorkerRow(p2)],
    })
    const replay = validateWorkerChunk(text, [p1, p2])
    expect(replay.ok).toBe(true)
  })

  it('merges without error so one failed row never blocks the others', () => {
    const p1 = makePlannedRow('1')
    const p2 = makePlannedRow('2')
    const blueprint = makeBlueprint({ planned_rows: [p1, p2] })
    const merged = mergeRows(blueprint, [
      makeWorkerRow(p1),
      placeholderWorkerRow(p2),
    ])
    expect(merged.ok).toBe(true)
    if (merged.ok) {
      expect(merged.rows[1]).toMatchObject({
        id: '2',
        question: '',
        options: [],
        correct_index: '',
      })
    }
  })
})
