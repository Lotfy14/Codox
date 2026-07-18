import { describe, expect, it } from 'vitest'
import { assembleBlueprint, type AssembleInput } from './assemble'
import type { ReconciledQuestion } from './enumerate'
import type { BoxedQuestion } from './index-pass'
import type { Box2d, Region } from './types'

function question(ref: string, label: string, over: Partial<ReconciledQuestion> = {}): ReconciledQuestion {
  return {
    ref, printedLabel: label, ownerPage: 1, sourcePages: [1], anchor: label,
    optionsPresent: true, caseStemKey: null, sectionHint: '', visibleYear: '',
    evidenceState: 'none', sectionKey: 'page-1', ...over,
  }
}

function region(box: Box2d): Region {
  return { page: 1, box_2d: box }
}

function boxed(ref: string, prompt: Box2d, options: Box2d, caseStem: Box2d | null = null): BoxedQuestion {
  return {
    ref, question: region(prompt), options: region(options),
    caseStem: caseStem === null ? null : region(caseStem), inlineEvidence: null,
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
      evidenceState: 'none',
      sectionKey: 'page-1',
    }
    const input: AssembleInput = {
      index: { questions: [question], pages: [], issues: [] },
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
      index: { questions: [question('q1', '1'), question('q2', '2')], pages: [], issues: [] },
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
        pages: [], issues: [],
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
      index: { questions: [question('q1', '1'), question('q2', '2'), question('q3', '3')], pages: [], issues: [] },
      boxes: {
        questions: [
          // Left-column q1, clipped options.
          boxed('q1', [437, 20, 507, 480], [508, 40, 540, 480]),
          // Same-column q2 below — the real bound (650).
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
      index: { questions: [question('q1', '1'), question('q2', '2')], pages: [], issues: [] },
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
    // q1's box already reaches q2's prompt top (300) — unchanged, not shrunk.
    expect(rows[0].regions.options?.box_2d).toEqual([151, 51, 300, 935])
    // q2 is last; extend to the footer margin and widen the column.
    expect(rows[1].regions.options?.box_2d).toEqual([351, 51, 975, 935])
  })
})
