import { describe, expect, it } from 'vitest'
import { reconcileIndexWindows, type ReconciledQuestion } from './enumerate'
import type { IndexedQuestion, IndexWindow } from './index-pass'

function q(ref: string, printedLabel: string, ownerPage: number, anchor: string): IndexedQuestion {
  return { ref, printedLabel, ownerPage, sourcePages: [ownerPage], anchor, optionsPresent: false, caseStemKey: null, sectionHint: '', visibleYear: '', evidenceState: 'none' }
}

describe('reconcileIndexWindows', () => {
  it('orders questions by printed numeric label per page', () => {
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q6', '27', 4, 'a'),
          q('w1q0', '21', 4, 'b'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['21', '27'])
  })

  it('keeps unnumbered questions between their numbered neighbours', () => {
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '8', 5, 'a'),
          q('w0q1', '', 5, 'b'),
          q('w0q2', '10', 5, 'c'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['8', '', '10'])
  })
})
