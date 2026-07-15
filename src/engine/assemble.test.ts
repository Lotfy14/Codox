import { describe, expect, it } from 'vitest'
import { assembleBlueprint, type AssembleInput } from './assemble'
import type { ReconciledQuestion } from './enumerate'

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
})
