import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Blueprint, MergedRow } from '../engine/types'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'
import {
  aiApplyPlan,
  answerSource,
  applyResolutions,
  composeReviewRows,
  effectiveAnswer,
  flagCategory,
  flaggedRows,
  getResolutions,
  isFlagged,
  loadReviewData,
  saveResolution,
  saveResolutions,
  unresolvedCount,
  type ReviewRow,
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
  it('maps the merge vocabulary onto the tutor explanations', () => {
    expect(flagCategory('conflicting_marks', '')).toBe('conflicting-marks')
    expect(flagCategory('label_style_mismatch', '')).toBe('length-mismatch')
    expect(flagCategory('key_unclear', '')).toBe('low-confidence')
    expect(flagCategory('no_answer_key', '')).toBe('blank-answer')
    expect(flagCategory('no_visible_answer', '')).toBe('blank-answer')
    expect(flagCategory('not_mcq', '')).toBe('not-mcq')
  })
})

describe('composeReviewRows', () => {
  const base = (id: string): ReviewRow => ({
    row: makeRow({ id, needs_review: '' }),
    questionNumber: 0,
    category: null,
    pageIndex: 0,
    box: null,
    figures: [],
  })

  it('folds added rows in after the engine rows and numbers them contiguously', () => {
    const added = makeRow({ id: 'added-x', question: 'Manual Q', needs_review: 'added_row' })
    const rows = composeReviewRows([base('1'), base('2')], [added], new Set(), {}, {})
    expect(rows.map((r) => r.row.id)).toEqual(['1', '2', 'added-x'])
    expect(rows.map((r) => r.questionNumber)).toEqual([1, 2, 3])
    // A blank added row (no correct_index) comes through flagged.
    expect(rows[2].category).not.toBeNull()
    // No blueprint entry → no source crop.
    expect(rows[2].pageIndex).toBeNull()
  })

  it('drops deleted rows and renumbers what remains', () => {
    const rows = composeReviewRows(
      [base('1'), base('2'), base('3')],
      [],
      new Set(['2']),
      {},
      {},
    )
    expect(rows.map((r) => r.row.id)).toEqual(['1', '3'])
    expect(rows.map((r) => r.questionNumber)).toEqual([1, 2])
  })

  it('leaves the engine rows untouched when there is nothing to add or delete', () => {
    const rows = composeReviewRows([base('1'), base('2')], [], new Set(), {}, {})
    expect(rows.map((r) => r.row.id)).toEqual(['1', '2'])
    expect(rows.map((r) => r.questionNumber)).toEqual([1, 2])
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
      makeRow({ id: '2', image_urls: ['images/asset01.jpg'] }),
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

  it('excludes answer_evidence from the crop so the question shows without the answer', async () => {
    // A present on-page answer carries a whole-page answer_evidence region.
    // The crop must NOT union it — otherwise it blows up to the full page and
    // reveals the answer inside the question preview.
    const answered: Pick<Blueprint, 'planned_rows'> = {
      planned_rows: [
        {
          id: '1', group_id: '', topic: '', subtopic: '', year: '',
          question_assembly: { mode: 'plain_question_prompt', final_format: '{question_prompt}' },
          regions: {
            case_stem: null,
            question_prompt: { page: 2, box_2d: [100, 50, 300, 900] },
            options: { page: 2, box_2d: [300, 50, 500, 900] },
            answer_evidence: { page: 2, box_2d: [0, 0, 1000, 1000] },
          },
          image_urls: [],
          correct_index_policy: { type: 'extract_visible_evidence', value: '', needs_review: '' },
          worker_task: { case_stem_required: false, read_regions_only: false, must_follow_planner_structure: true },
        },
      ],
    }
    await putArtifact({ runId: 'run-ans', kind: 'merged-rows', json: [makeRow({ id: '1', correct_index: '0', needs_review: '' })] })
    await putArtifact({ runId: 'run-ans', kind: 'blueprint-valid', json: answered })
    const reviewRow = (await loadReviewData('run-ans')).reviewRows[0]
    // Union of the two question regions only, padded — NOT the whole page.
    expect(reviewRow.box).toEqual([70, 20, 530, 930])
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
    const row = makeRow({ id: '2', correct_index: '0', needs_review: '', image_urls: ['images/asset01.jpg'] })
    await putArtifact({ runId: 'run3', kind: 'merged-rows', json: [row] })
    await putArtifact({ runId: 'run3', kind: 'blueprint-valid', json: blueprint })
    const reviewRow = (await loadReviewData('run3')).reviewRows[0]
    expect(reviewRow.category).toBeNull()
    expect(reviewRow.pageIndex).toBe(1)
    expect(reviewRow.box).toEqual([70, 20, 530, 930])
  })

  it('shows crop box for all rows', async () => {
    const figBlueprint: Pick<Blueprint, 'planned_rows'> = {
      planned_rows: [
        {
          id: '1',
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
            question_prompt: { page: 1, box_2d: [100, 100, 400, 900] },
            options: { page: 1, box_2d: [400, 100, 600, 900] },
            answer_evidence: null,
          },
          image_urls: ['images/asset01.jpg'],
          correct_index_policy: { type: 'blank_no_answer_key', value: '', needs_review: 'no_answer_key' },
          worker_task: {
            case_stem_required: false,
            read_regions_only: false,
            must_follow_planner_structure: true,
          },
        },
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
            question_prompt: { page: 1, box_2d: [100, 100, 400, 900] },
            options: { page: 1, box_2d: [400, 100, 600, 900] },
            answer_evidence: null,
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
    const rows = [
      makeRow({ id: '1', correct_index: '0', needs_review: '', image_urls: ['images/asset01.jpg'] }),
      makeRow({ id: '2', correct_index: '0', needs_review: '' }),
    ]
    await putArtifact({ runId: 'run-fig', kind: 'merged-rows', json: rows })
    await putArtifact({ runId: 'run-fig', kind: 'blueprint-valid', json: figBlueprint })
    const data = await loadReviewData('run-fig')
    expect(data.reviewRows[0].box).not.toBeNull()
    expect(data.reviewRows[1].box).not.toBeNull()
  })

  it('attaches linked figures to their rows from blueprint assets', async () => {
    const withAssets: Pick<Blueprint, 'planned_rows' | 'assets'> = {
      ...blueprint,
      assets: [
        {
          asset_id: 'asset01',
          kind: 'question_figure',
          page: 2,
          box_2d: [200, 100, 500, 800],
          output_path: 'images/asset01.jpg',
          linked_group_id: '',
          linked_row_ids: ['2'],
          anchor: '',
        },
      ],
    }
    const rows = [
      makeRow({ id: '1', correct_index: '0', needs_review: '' }),
      makeRow({ id: '2', image_urls: ['images/asset01.jpg'] }),
    ]
    await putArtifact({ runId: 'run-asset', kind: 'merged-rows', json: rows })
    await putArtifact({ runId: 'run-asset', kind: 'blueprint-valid', json: withAssets })
    const data = await loadReviewData('run-asset')
    expect(data.reviewRows[0].figures).toEqual([])
    // 1-based asset page becomes a 0-based figure page index; the box is
    // padded ~4% (FIGURE_BOX_PAD) so the preview matches the exported crop.
    expect(data.reviewRows[1].figures).toEqual([
      { path: 'images/asset01.jpg', pageIndex: 1, box: [160, 60, 540, 840] },
    ])
  })
})

describe('effectiveAnswer', () => {
  const reviewRow = {
    row: makeRow({ correct_index: '1', needs_review: '' }),
    questionNumber: 1,
    category: null,
    pageIndex: null,
    box: null,
    figures: [],
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
    figures: [],
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

describe('aiApplyPlan (the bulk-switch approval summary)', () => {
  const reviewRow = (row: MergedRow) => ({
    row,
    questionNumber: 1,
    category: null,
    pageIndex: null,
    box: null,
    figures: [],
  })

  it('splits rows into fill / differ / agree / unsure and picks only fill+differ', () => {
    const rows = [
      reviewRow(makeRow({ id: 'blank' })),
      reviewRow(makeRow({ id: 'differs', correct_index: '0', needs_review: '' })),
      reviewRow(makeRow({ id: 'agrees', correct_index: '2', needs_review: '' })),
      reviewRow(makeRow({ id: 'shy' })),
      reviewRow(makeRow({ id: 'untouched' })),
    ]
    const plan = aiApplyPlan(rows, {}, {
      blank: { index: 1, confidence: 'certain' },
      differs: { index: 2, confidence: 'likely' },
      agrees: { index: 2, confidence: 'certain' },
      shy: { index: null, confidence: 'unsure' },
    })
    expect(plan).toEqual({
      picks: { blank: 1, differs: 2 },
      fillCount: 1,
      differCount: 1,
      agreeCount: 1,
      unsureCount: 1,
    })
  })

  it('an unsure confidence or invalid index is never applied in bulk', () => {
    const rows = [reviewRow(makeRow({ id: 'a' })), reviewRow(makeRow({ id: 'b' }))]
    const plan = aiApplyPlan(rows, {}, {
      a: { index: 1, confidence: 'unsure' },
      b: { index: 99, confidence: 'certain' },
    })
    expect(plan.picks).toEqual({})
    expect(plan.unsureCount).toBe(2)
  })

  it('a human resolution is the current answer the AI is compared against', () => {
    const rows = [reviewRow(makeRow({ id: 'r', correct_index: '0', needs_review: '' }))]
    const agreeing = aiApplyPlan(rows, { r: 2 }, { r: { index: 2, confidence: 'certain' } })
    expect(agreeing.agreeCount).toBe(1)
    expect(agreeing.picks).toEqual({})
  })
})

describe('saveResolutions (bulk apply)', () => {
  it('merges many approved picks into the resolutions artifact at once', async () => {
    await saveResolution('run-bulk', 'kept', 0)
    await saveResolutions('run-bulk', { a: 1, b: 2 })
    expect(await getResolutions('run-bulk')).toEqual({ kept: 0, a: 1, b: 2 })
  })

  it('an empty pick set writes nothing', async () => {
    await saveResolutions('run-empty', {})
    expect(await getResolutions('run-empty')).toEqual({})
  })
})
