import { describe, expect, it } from 'vitest'
import { reconcileIndexWindows, type ReconciledQuestion } from './enumerate'
import type { IndexedQuestion, IndexWindow } from './index-pass'

function q(ref: string, printedLabel: string, ownerPage: number, anchor: string): IndexedQuestion {
  return { ref, printedLabel, ownerPage, sourcePages: [ownerPage], anchor, optionsPresent: false, caseStemKey: null, sectionHint: '', visibleYear: '', evidenceState: 'none' }
}

describe('reconcileIndexWindows', () => {
  it('keeps a page in the reading order INDEX emitted, not numeric order', () => {
    // Emitted top-to-bottom as 27 then 21; a real page can number that way,
    // so reading order (the ref ordinal) wins over the printed number.
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '27', 4, 'a'),
          q('w0q1', '21', 4, 'b'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['27', '21'])
  })

  it('a misread label does not leapfrog a question to the top of its page', () => {
    // Glare turns 19 into "1"; reading order must still place it last.
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '16', 5, 'a'),
          q('w0q1', '17', 5, 'b'),
          q('w0q2', '18', 5, 'c'),
          q('w0q3', '1', 5, 'd'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['16', '17', '18', '1'])
  })

  it('never invents a missing question from a non-sequential numeric gap', () => {
    // A genuine 18→20 jump (real exams skip numbers) must not flag a phantom 19.
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '18', 5, 'a'),
          q('w0q1', '20', 5, 'b'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.issues).toEqual([])
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['18', '20'])
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

  it('does not deduplicate separate unnumbered questions on the same page with the same anchor', () => {
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '', 5, 'Which of the following'),
          q('w0q1', '', 5, 'Which of the following'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(2)
  })

  it('deduplicates numbered questions across window boundaries if labels match and pages are close', () => {
    const windows: IndexWindow[] = [
      {
        questions: [q('w0q0', '18', 10, 'Some anchor')],
        pages: [],
      },
      {
        questions: [q('w1q0', '18', 11, 'Some anchor')],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
    expect(result.questions[0].ownerPage).toBe(10)
  })

  it('does not deduplicate numbered questions on the same page if printed labels differ even with same anchor', () => {
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '18', 5, 'Which of the following'),
          q('w0q1', '19', 5, 'Which of the following'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(2)
  })

  it('deduplicates questions across page boundaries with mismatched labels if the anchor is identical and non-generic', () => {
    const windows: IndexWindow[] = [
      {
        questions: [q('w0q0', '15', 20, 'You are seeing')],
        pages: [],
      },
      {
        questions: [q('w1q0', '18', 21, 'You are seeing')],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
    expect(result.questions[0].ownerPage).toBe(20)
  })

  it('does not deduplicate questions across page boundaries with mismatched labels if the anchor is generic', () => {
    const windows: IndexWindow[] = [
      {
        questions: [q('w0q0', '15', 20, 'Which of the following')],
        pages: [],
      },
      {
        questions: [q('w1q0', '18', 21, 'Which of the following')],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(2)
  })

  it('deduplicates questions across page boundaries with mismatched labels if one anchor is a prefix of another non-generic anchor', () => {
    const windows: IndexWindow[] = [
      {
        questions: [q('w0q0', '15', 20, 'You are seeing')],
        pages: [],
      },
      {
        questions: [q('w1q0', '18', 21, 'You are seeing a 17-year-old')],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
    expect(result.questions[0].ownerPage).toBe(20)
  })
})
