import { describe, expect, it } from 'vitest'
import {
  keepIndexObservedMarks,
  missedInlineAnswerRowIds,
  modalOptionCount,
  placeholderWorkerRow,
  repairTargetPages,
  underTranscribedRowIds,
} from './executor'
import { mergeRows, validateWorkerChunk } from './merge'
import { makeBlueprint, makePlannedRow, makeRegion, makeWorkerRow } from './fixtures'
import type { EvidenceMap } from './index-pass'
import type { Blueprint, PlannedRow } from './types'

describe('repairTargetPages', () => {
  const exam = new Set([1, 2, 3, 4, 5])

  it('targets a reconcile page-gap the model under-enumerated', () => {
    // Page 4 flagged by reconcile, nothing owns it → re-index it alone.
    const owned = new Set([1, 2, 3, 5])
    expect(repairTargetPages([], [4], owned, exam)).toEqual([4])
  })

  it('targets the core pages of a window that would not parse', () => {
    const owned = new Set([1, 2])
    expect(repairTargetPages([3, 4, 5], [], owned, exam)).toEqual([3, 4, 5])
  })

  it('unions both sources without duplicating a page', () => {
    const owned = new Set([1, 2])
    expect(repairTargetPages([3, 4], [4, 5], owned, exam)).toEqual([3, 4, 5])
  })

  it('never re-indexes a page a window already owns', () => {
    const owned = new Set([1, 2, 3])
    expect(repairTargetPages([3], [3], owned, exam)).toEqual([])
  })

  it('drops a flagged page outside the exam (an answer-key or hallucinated page)', () => {
    const owned = new Set([1, 2])
    expect(repairTargetPages([], [3, 9], owned, exam)).toEqual([3])
  })
})

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

/**
 * The 2026-07-30 page-boundary defect: a question's prompt and first options
 * print at the bottom of page N and the rest continue at the top of page N+1,
 * and only the page-N part is transcribed. Geometry alone would fire on every
 * complete last-question-on-a-page; a low option count alone would fire on
 * every genuinely short question. Both together are the signal.
 */
describe('underTranscribedRowIds at a page boundary', () => {
  function stacked(id: string, page: number, top: number, bottom: number): PlannedRow {
    return makePlannedRow(id, {
      regions: {
        case_stem: null,
        question_prompt: { page, box_2d: [top, 51, top + 40, 935] },
        options: { page, box_2d: [top + 41, 51, bottom, 935] },
        answer_evidence: null,
      },
    })
  }

  /** Four rows down page 1 of a two-page exam; row '4' ends the page. */
  function page1Exam(): { blueprint: Blueprint; rows: PlannedRow[] } {
    const rows = [
      stacked('1', 1, 60, 200),
      stacked('2', 1, 260, 400),
      stacked('3', 1, 460, 600),
      stacked('4', 1, 660, 940),
    ]
    const blueprint = makeBlueprint({ planned_rows: rows })
    blueprint.document_profile.page_count = 2
    return { blueprint, rows }
  }

  const four = ['Alpha', 'Beta', 'Gamma', 'Delta']

  it('flags the last row on a page that came back short of the document norm', () => {
    const { blueprint, rows } = page1Exam()
    const worker = [
      makeWorkerRow(rows[0], { options: four }),
      makeWorkerRow(rows[1], { options: four }),
      makeWorkerRow(rows[2], { options: four }),
      // Options a–c transcribed; d was printed at the top of page 2.
      makeWorkerRow(rows[3], { options: ['Alpha', 'Beta', 'Gamma'] }),
    ]
    expect(underTranscribedRowIds(blueprint, worker)).toEqual(['4'])
  })

  it('leaves the same row alone when it came back complete', () => {
    const { blueprint, rows } = page1Exam()
    const worker = rows.map((row) => makeWorkerRow(row, { options: four }))
    expect(underTranscribedRowIds(blueprint, worker)).toEqual([])
  })

  it('leaves a short row alone when it is NOT at a page boundary', () => {
    // Row '2' has questions below it on the page, so its three options were
    // printed in full — a genuinely short question, not a clipped one.
    const { blueprint, rows } = page1Exam()
    const worker = [
      makeWorkerRow(rows[0], { options: four }),
      makeWorkerRow(rows[1], { options: ['Alpha', 'Beta', 'Gamma'] }),
      makeWorkerRow(rows[2], { options: four }),
      makeWorkerRow(rows[3], { options: four }),
    ]
    expect(underTranscribedRowIds(blueprint, worker)).toEqual([])
  })

  it('spends nothing on a document with no dominant option count', () => {
    // A mixed paper gives no norm to be short of, so only the <2 rule runs.
    const { blueprint, rows } = page1Exam()
    const worker = [
      makeWorkerRow(rows[0], { options: ['A', 'B'] }),
      makeWorkerRow(rows[1], { options: ['A', 'B', 'C'] }),
      makeWorkerRow(rows[2], { options: four }),
      makeWorkerRow(rows[3], { options: ['A', 'B', 'C'] }),
    ]
    expect(underTranscribedRowIds(blueprint, worker)).toEqual([])
  })
})

describe('modalOptionCount', () => {
  const row = (n: number) =>
    makeWorkerRow(makePlannedRow('x'), {
      options: Array.from({ length: n }, (_, i) => `opt${i}`),
    })

  it('reads the norm of a uniform paper', () => {
    expect(modalOptionCount([row(4), row(4), row(4), row(4), row(3)])).toBe(4)
  })

  it('is null when too few rows have options to mean anything', () => {
    expect(modalOptionCount([row(4), row(4), row(4)])).toBeNull()
  })

  it('is null when no count holds a majority', () => {
    expect(modalOptionCount([row(2), row(3), row(4), row(5), row(6)])).toBeNull()
  })

  it('ignores the very rows under suspicion, so they cannot lower the norm', () => {
    // Four one-option rows would otherwise be the mode.
    expect(
      modalOptionCount([row(1), row(1), row(1), row(1), row(5), row(5), row(5), row(5)]),
    ).toBe(5)
  })
})

/**
 * The 2026-07-30 mixed-evidence defect: EVIDENCE only ever reads the attached
 * KEY pages, but its type became the document policy — and `forceAnswer` blanks
 * every row on `uncertain`/`no_answer_key` before any per-row logic runs.
 */
describe('keepIndexObservedMarks', () => {
  const evidence = (type: EvidenceMap['type']): EvidenceMap => ({
    type,
    markingStyle: 'circle',
    evidence: [{ ref: 'w0q0', region: null, state: 'illegible' }],
  })

  it('keeps the answers INDEX saw when the attached key is unreadable', () => {
    expect(keepIndexObservedMarks(evidence('uncertain'), true).type).toBe('mixed')
  })

  it('does the same when the key pages turn out to hold no key at all', () => {
    expect(keepIndexObservedMarks(evidence('no_answer_key'), true).type).toBe('mixed')
  })

  it('carries the per-ref key evidence through untouched', () => {
    const result = keepIndexObservedMarks(evidence('uncertain'), true)
    expect(result.evidence).toEqual(evidence('uncertain').evidence)
    expect(result.markingStyle).toBe('circle')
  })

  it('leaves the policy alone when INDEX saw no marks on the exam pages', () => {
    expect(keepIndexObservedMarks(evidence('uncertain'), false).type).toBe('uncertain')
    expect(keepIndexObservedMarks(evidence('no_answer_key'), false).type).toBe(
      'no_answer_key',
    )
  })

  it('never downgrades a key the EVIDENCE stage could read', () => {
    expect(keepIndexObservedMarks(evidence('separate_key'), true).type).toBe('separate_key')
    expect(keepIndexObservedMarks(evidence('inline_marks'), true).type).toBe('inline_marks')
    expect(keepIndexObservedMarks(evidence('mixed'), true).type).toBe('mixed')
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

describe('missedInlineAnswerRowIds', () => {
  it('retries a blank row only when the same page has a readable inline answer', () => {
    const answered = makePlannedRow('1', {
      regions: { case_stem: null, question_prompt: makeRegion(1), options: makeRegion(1), answer_evidence: makeRegion(1) },
      correct_index_policy: { type: 'extract_visible_evidence', value: '', needs_review: '' },
    })
    const blank = makePlannedRow('2', {
      regions: { case_stem: null, question_prompt: makeRegion(1), options: makeRegion(1), answer_evidence: makeRegion(1) },
      correct_index_policy: { type: 'extract_visible_evidence', value: '', needs_review: '' },
    })
    const blueprint = makeBlueprint({ planned_rows: [answered, blank] })
    blueprint.document_profile.answer_policy.type = 'inline_marks'
    expect(missedInlineAnswerRowIds(blueprint, [
      makeWorkerRow(answered, { correct_index: '4' }),
      makeWorkerRow(blank),
    ])).toEqual(['2'])
  })

  it('does not retry blanks from an exam with no inline answer evidence', () => {
    const row = makePlannedRow('1')
    expect(missedInlineAnswerRowIds(makeBlueprint({ planned_rows: [row] }), [makeWorkerRow(row)])).toEqual([])
  })
})