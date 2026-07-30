import { describe, expect, it } from 'vitest'
import { assembleBlueprint, pageBoundaryOptionRowIds, type AssembleInput } from './assemble'
import type { ReconciledQuestion } from './enumerate'
import type { BoxedQuestion } from './index-pass'
import { makeBlueprint, makePlannedRow } from './fixtures'
import type { Blueprint, Box2d, PlannedRow, Region } from './types'

function question(ref: string, label: string, over: Partial<ReconciledQuestion> = {}): ReconciledQuestion {
  return {
    ref, printedLabel: label, ownerPage: 1, sourcePages: [1], anchor: label,
    optionsPresent: true, caseStemKey: null, sectionHint: '', visibleYear: '',
    answerPresent: false, sectionKey: 'page-1', ...over,
  }
}

function region(box: Box2d): Region {
  return { page: 1, box_2d: box }
}

function boxed(
  ref: string, prompt: Box2d, options: Box2d, caseStem: Box2d | null = null,
  inlineEvidence: Box2d | null = null,
): BoxedQuestion {
  return {
    ref, question: region(prompt), options: region(options),
    caseStem: caseStem === null ? null : region(caseStem),
    inlineEvidence: inlineEvidence === null ? null : region(inlineEvidence),
  }
}

describe('assembleBlueprint', () => {
  it('recovers box-less questions as whole-page rows', () => {
    const question: ReconciledQuestion = {
      ref: 'w0q0',
      printedLabel: '1',
      ownerPage: 1,
      sourcePages: [1],
      anchor: 'Q1',
      optionsPresent: true,
      caseStemKey: null,
      sectionHint: '',
      visibleYear: '',
      answerPresent: false,
      sectionKey: 'page-1',
    }
    const input: AssembleInput = {
      index: { questions: [question] },
      boxes: { questions: [], figures: [] },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const blueprint = assembleBlueprint(input)
    expect(blueprint.planned_rows).toHaveLength(1)
    const row = blueprint.planned_rows[0]
    expect(row.regions.question_prompt).toEqual({ page: 1, box_2d: [0, 0, 1000, 1000] })
    expect(row.regions.options).toEqual({ page: 1, box_2d: [0, 0, 1000, 1000] })
  })

  it('extends an options box clipped to the first option down to the next question', () => {
    // The 2026-07-18 failure: BOX drew q1's options around only option "a".
    const input: AssembleInput = {
      index: { questions: [question('q1', '1'), question('q2', '2')] },
      boxes: {
        questions: [
          boxed('q1', [437, 51, 507, 935], [508, 133, 592, 590]),
          boxed('q2', [600, 51, 650, 935], [651, 133, 900, 590]),
        ],
        figures: [],
      },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const [q1] = assembleBlueprint(input).planned_rows
    // ymax grows to q2's prompt top (600); x widens to the prompt column.
    expect(q1.regions.options?.box_2d).toEqual([508, 51, 600, 935])
  })

  it('stops the extended box before a following case stem, not at its question', () => {
    const input: AssembleInput = {
      index: {
        questions: [question('q1', '1'), question('q2', '2', { caseStemKey: 'caseA' })],
      },
      boxes: {
        questions: [
          boxed('q1', [437, 51, 507, 935], [508, 133, 540, 590]),
          // q2's case stem (700) sits above its prompt (760); the box must
          // stop at the stem, never spill into it.
          boxed('q2', [760, 51, 820, 935], [821, 133, 900, 590], [700, 51, 758, 935]),
        ],
      figures: [],
      },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const [q1] = assembleBlueprint(input).planned_rows
    expect(q1.regions.options?.box_2d[2]).toBe(700)
  })

  it('does not let a different column cap the box early', () => {
    const input: AssembleInput = {
      index: { questions: [question('q1', '1'), question('q2', '2'), question('q3', '3')] },
      boxes: {
        questions: [
          // Left-column q1, clipped options.
          boxed('q1', [437, 20, 507, 480], [508, 40, 540, 480]),
          // Same-column q2 below â€” the real bound (650).
          boxed('q2', [650, 20, 700, 480], [701, 40, 900, 480]),
          // Right-column q3 starts lower (560) but must NOT cap q1.
          boxed('q3', [560, 520, 700, 980], [701, 540, 900, 980]),
        ],
        figures: [],
      },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const [q1] = assembleBlueprint(input).planned_rows
    expect(q1.regions.options?.box_2d[2]).toBe(650)
  })

  it('extends the last question on a page to a footer margin, and never shrinks a good box', () => {
    const input: AssembleInput = {
      index: { questions: [question('q1', '1'), question('q2', '2')] },
      boxes: {
        questions: [
          boxed('q1', [100, 51, 150, 935], [151, 51, 200, 935]),
          // Last on page, clipped.
          boxed('q2', [300, 51, 350, 935], [351, 133, 400, 590]),
        ],
        figures: [],
      },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const rows = assembleBlueprint(input).planned_rows
    // q1's box already reaches q2's prompt top (300) â€” unchanged, not shrunk.
    expect(rows[0].regions.options?.box_2d).toEqual([151, 51, 300, 935])
    // q2 is last; extend to the footer margin and widen the column.
    expect(rows[1].regions.options?.box_2d).toEqual([351, 51, 975, 935])
  })

  it('answer_present true is extractable; false is blank; both never guessed', () => {
    const input: AssembleInput = {
      index: {
        questions: [
          question('q1', '1', { answerPresent: true }),
          question('q2', '2', { answerPresent: false }),
        ],
      },
      boxes: { questions: [], figures: [] },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const [present, absent] = assembleBlueprint(input).planned_rows
    // Present: a whole-page evidence region and a policy that permits extraction.
    expect(present.regions.answer_evidence).toEqual({ page: 1, box_2d: [0, 0, 1000, 1000] })
    expect(present.correct_index_policy.type).toBe('extract_visible_evidence')
    // Absent: no region, blank policy, never guessed.
    expect(absent.regions.answer_evidence).toBeNull()
    expect(absent.correct_index_policy.type).toBe('blank_no_visible_answer')
  })

  it('the answer never depends on BOX: a BOX inline_evidence region is ignored', () => {
    // The box path is display-only. Even if BOX draws an answer region, the
    // answer_evidence stays the whole page (read off the page), not the box.
    const input: AssembleInput = {
      index: { questions: [question('q1', '1', { answerPresent: true })] },
      boxes: {
        questions: [boxed('q1', [100, 50, 200, 900], [200, 50, 400, 900], null, [10, 10, 40, 40])],
        figures: [],
      },
      evidence: { type: 'no_answer_key', markingStyle: '', evidence: [] },
      pageCount: 1,
    }
    const [row] = assembleBlueprint(input).planned_rows
    expect(row.regions.answer_evidence).toEqual({ page: 1, box_2d: [0, 0, 1000, 1000] })
  })
})

describe('pageBoundaryOptionRowIds', () => {
  /** A row whose prompt and options sit at the given vertical band on `page`. */
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

  function blueprintOf(rows: PlannedRow[], pageCount: number): Blueprint {
    const blueprint = makeBlueprint({ planned_rows: rows })
    blueprint.document_profile.page_count = pageCount
    return blueprint
  }

  it('flags the last question on a page that has a page after it', () => {
    // q3 is the bottom of page 1; its printed options may run onto page 2.
    const rows = [
      stacked('1', 1, 100, 240),
      stacked('2', 1, 300, 440),
      stacked('3', 1, 500, 900),
    ]
    expect(pageBoundaryOptionRowIds(blueprintOf(rows, 2))).toEqual(['3'])
  })

  it('never flags a row on the final page — there is nothing to continue onto', () => {
    const rows = [stacked('1', 2, 100, 240), stacked('2', 2, 500, 900)]
    expect(pageBoundaryOptionRowIds(blueprintOf(rows, 2))).toEqual([])
  })

  it('flags the last row of every page independently', () => {
    const rows = [
      stacked('1', 1, 100, 240),
      stacked('2', 1, 500, 900),
      stacked('3', 2, 100, 240),
      stacked('4', 2, 500, 900),
    ]
    // Page 3 exists, so page 2's last row is a suspect too.
    expect(pageBoundaryOptionRowIds(blueprintOf(rows, 3))).toEqual(['2', '4'])
  })

  it('ignores a row with no options region', () => {
    const rows = [
      makePlannedRow('1', {
        regions: {
          case_stem: null,
          question_prompt: { page: 1, box_2d: [100, 51, 140, 935] },
          options: null,
          answer_evidence: null,
        },
      }),
    ]
    expect(pageBoundaryOptionRowIds(blueprintOf(rows, 2))).toEqual([])
  })

  it('does not treat a row capped by a NEIGHBOURING column as last on the page', () => {
    // Left column q1 is followed by q2; the right column's q3 sits lower but
    // belongs to another column, so it must not decide q1 either way.
    const rows: PlannedRow[] = [
      makePlannedRow('1', {
        regions: {
          case_stem: null,
          question_prompt: { page: 1, box_2d: [100, 20, 140, 480] },
          options: { page: 1, box_2d: [141, 20, 300, 480] },
          answer_evidence: null,
        },
      }),
      makePlannedRow('2', {
        regions: {
          case_stem: null,
          question_prompt: { page: 1, box_2d: [400, 20, 440, 480] },
          options: { page: 1, box_2d: [441, 20, 900, 480] },
          answer_evidence: null,
        },
      }),
      makePlannedRow('3', {
        regions: {
          case_stem: null,
          question_prompt: { page: 1, box_2d: [200, 520, 240, 980] },
          options: { page: 1, box_2d: [241, 520, 900, 980] },
          answer_evidence: null,
        },
      }),
    ]
    // q1 is capped by q2 (same column). q2 and q3 each end their own column.
    expect(pageBoundaryOptionRowIds(blueprintOf(rows, 2))).toEqual(['2', '3'])
  })
})

