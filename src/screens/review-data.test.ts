import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Blueprint, MergedRow } from '../engine/types'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'
import {
  answerSource,
  applyResolutions,
  effectiveAnswer,
  flagCategory,
  flaggedRows,
  getResolutions,
  isFlagged,
  loadReviewData,
  saveResolution,
  unresolvedCount,
} from './review-data'

function makeRow(overrides: Partial<MergedRow> = {}): MergedRow {
  return {
    id: '1',
    group_id: '',
    topic: '',
    subtopic: '',
    year: '',
    question: 'What is the diagnosis?',
    options: ['Appendicitis', 'Cholecystitis', 'Pancreatitis'],
    correct_index: '',
    image_urls: [],
    needs_review: 'no_answer_key',
    ...overrides,
  }
}

beforeEach(async () => {
  await db.runArtifacts.clear()
  await db.runs.clear()
})

describe('flagCategory', () => {
  it('maps the merge vocabulary onto the four tutor explanations', () => {
    expect(flagCategory('conflicting_marks', '')).toBe('conflicting-marks')
    expect(flagCategory('label_style_mismatch', '')).toBe('length-mismatch')
    expect(flagCategory('key_unclear', '')).toBe('low-confidence')
    expect(flagCategory('no_answer_key', '')).toBe('blank-answer')
    expect(flagCategory('no_visible_answer', '')).toBe('blank-answer')
  })
})

describe('applyResolutions (NEVER-GUESS stays intact)', () => {
  it('fills only explicitly confirmed answers and clears their flag', () => {
    const rows = [makeRow({ id: '1' }), makeRow({ id: '2' })]
    const applied = applyResolutions(rows, { '1': 2 })
    expect(applied[0].correct_index).toBe('2')
    expect(applied[0].needs_review).toBe('')
    expect(applied[1].correct_index).toBe('')
    expect(applied[1].needs_review).toBe('no_answer_key')
  })

  it('ignores out-of-range or non-integer picks — the flag stays', () => {
    const rows = [makeRow({ id: '1' })]
    for (const bad of [3, -1, 1.5, Number.NaN]) {
      const applied = applyResolutions(rows, { '1': bad })
      expect(applied[0].correct_index).toBe('')
      expect(applied[0].needs_review).toBe('no_answer_key')
    }
  })

  it('never mutates the engine rows', () => {
    const rows = [makeRow({ id: '1' })]
    applyResolutions(rows, { '1': 0 })
    expect(rows[0].correct_index).toBe('')
  })

  it('counts unresolved flags for the done stage', () => {
    const rows = [makeRow({ id: '1' }), makeRow({ id: '2' })]
    expect(unresolvedCount(rows, {})).toBe(2)
    expect(unresolvedCount(rows, { '1': 0 })).toBe(1)
    // An invalid pick is ignored, so its row is still unresolved.
    expect(unresolvedCount(rows, { '1': 0, '2': 9 })).toBe(1)
  })
})

describe('resolutions persistence', () => {
  it('saves, merges, and re-reads picks for a run', async () => {
    await saveResolution('run1', '1', 2)
    await saveResolution('run1', '2', 0)
    await saveResolution('run1', '1', 1) // re-confirming overwrites
    expect(await getResolutions('run1')).toEqual({ '1': 1, '2': 0 })
    // Exactly one artifact row holds them.
    const artifact = await getArtifact('run1', 'review-resolutions')
    expect(artifact?.json).toEqual({ '1': 1, '2': 0 })
  })
})

describe('loadReviewData', () => {
  const blueprint: Pick<Blueprint, 'planned_rows'> = {
    planned_rows: [
      {
        id: '2',
        group_id: '',
        topic: '',
        subtopic: '',
        year: '',
        question_assembly: {
          mode: 'plain_question_prompt',
          final_format: '{question_prompt}',
        },
        regions: {
          case_stem: null,
          question_prompt: { page: 2, box_2d: [100, 50, 300, 900] },
          options: { page: 2, box_2d: [300, 50, 500, 900] },
          answer_evidence: { page: 3, box_2d: [0, 0, 100, 100] },
        },
        image_urls: [],
        correct_index_policy: { type: 'blank_no_answer_key', value: '', needs_review: 'no_answer_key' },
        worker_task: {
          case_stem_required: false,
          read_regions_only: false,
          must_follow_planner_structure: true,
        },
      },
    ],
  }

  it('returns every row with question numbers and padded regions', async () => {
    const rows = [
      makeRow({ id: '1', correct_index: '0', needs_review: '' }),
      makeRow({ id: '2' }),
    ]
    await putArtifact({ runId: 'run1', kind: 'merged-rows', json: rows })
    await putArtifact({ runId: 'run1', kind: 'blueprint-valid', json: blueprint })

    const data = await loadReviewData('run1')
    expect(data.rows).toHaveLength(2)
    expect(data.reviewRows).toHaveLength(2)
    expect(data.reviewRows[0].category).toBeNull()
    const flag = data.reviewRows[1]
    expect(flag.row.id).toBe('2')
    expect(flag.questionNumber).toBe(2)
    expect(flag.category).toBe('blank-answer')
    // 0-based page from the question_prompt region's 1-based page.
    expect(flag.pageIndex).toBe(1)
    // Union of the two page-2 regions, padded, clamped to 0–1000; the
    // page-3 answer_evidence region is not unioned across pages.
    expect(flag.box).toEqual([70, 20, 530, 930])
    expect(flaggedRows(data)).toEqual([flag])
  })

  it('flags rows without a blueprint region as page-less', async () => {
    await putArtifact({ runId: 'run2', kind: 'merged-rows', json: [makeRow()] })
    const data = await loadReviewData('run2')
    expect(data.reviewRows[0].pageIndex).toBeNull()
    expect(data.reviewRows[0].box).toBeNull()
  })

  it('isFlagged matches blank answers and recorded reasons only', () => {
    expect(isFlagged(makeRow())).toBe(true)
    expect(isFlagged(makeRow({ correct_index: '1', needs_review: '' }))).toBe(false)
  })

  it('keeps real source regions on unflagged rows', async () => {
    const row = makeRow({ id: '2', correct_index: '0', needs_review: '' })
    await putArtifact({ runId: 'run3', kind: 'merged-rows', json: [row] })
    await putArtifact({ runId: 'run3', kind: 'blueprint-valid', json: blueprint })
    const reviewRow = (await loadReviewData('run3')).reviewRows[0]
    expect(reviewRow.category).toBeNull()
    expect(reviewRow.pageIndex).toBe(1)
    expect(reviewRow.box).toEqual([70, 20, 530, 930])
  })
})

describe('effectiveAnswer', () => {
  const reviewRow = {
    row: makeRow({ correct_index: '1', needs_review: '' }),
    questionNumber: 1,
    category: null,
    pageIndex: null,
    box: null,
  }

  it('uses a valid resolution before the engine answer', () => {
    expect(effectiveAnswer(reviewRow, { '1': 2 })).toBe(2)
    expect(effectiveAnswer(reviewRow, {})).toBe(1)
  })

  it('ignores invalid resolutions and validates the engine answer', () => {
    expect(effectiveAnswer(reviewRow, { '1': 9 })).toBe(1)
    expect(effectiveAnswer({ ...reviewRow, row: makeRow({ correct_index: '9' }) }, {})).toBeNull()
  })
})

describe('answerSource', () => {
  const reviewRow = (row: MergedRow) => ({
    row,
    questionNumber: 1,
    category: null,
    pageIndex: null,
    box: null,
  })

  it('uses extracted answer when no resolution', () => {
    expect(answerSource(reviewRow(makeRow({ correct_index: '1' })), {})).toEqual({
      index: 1,
      source: 'extracted',
    })
  })

  it('human override beats extracted', () => {
    expect(answerSource(reviewRow(makeRow({ id: '1', correct_index: '1' })), { '1': 2 })).toEqual({
      index: 2,
      source: 'human',
    })
  })

  it('ai fallback when no extracted answer', () => {
    expect(
      answerSource(reviewRow(makeRow({ id: '1', correct_index: '' })), {}, { '1': { index: 0, confidence: 'likely' } }),
    ).toEqual({ index: 0, source: 'ai' })
  })

  it('extracted beats ai', () => {
    expect(
      answerSource(reviewRow(makeRow({ id: '1', correct_index: '2' })), {}, { '1': { index: 0, confidence: 'certain' } }),
    ).toEqual({ index: 2, source: 'extracted' })
  })

  it('none when no answer is available', () => {
    expect(
      answerSource(reviewRow(makeRow({ id: '1', correct_index: '' })), {}, { '1': { index: null, confidence: 'unsure' } }),
    ).toEqual({ index: null, source: 'none' })
  })
})
