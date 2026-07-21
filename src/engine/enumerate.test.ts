import { describe, expect, it } from 'vitest'
import { reconcileIndexWindows, type ReconciledQuestion } from './enumerate'
import type { IndexedQuestion, IndexWindow } from './index-pass'

function q(ref: string, printedLabel: string, ownerPage: number, anchor: string): IndexedQuestion {
  return { ref, printedLabel, ownerPage, sourcePages: [ownerPage], anchor, optionsPresent: false, caseStemKey: null, sectionHint: '', visibleYear: '', answerPresent: false }
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

  it('keeps distinct questions in one window whose formulaic stems share a prefix', () => {
    // Regression: a real 100-question paper lost 8 questions here. Exam stems
    // are boilerplate ("A 25-year-old man presents with …"), so prefix
    // matching treated separate questions as duplicates, and isGenericAnchor
    // passed them as "specific". One window = one reading pass = no duplicates.
    const windows: IndexWindow[] = [
      {
        questions: [
          q('w0q0', '2', 1, 'A 2-year-old boy presents with a barking cough'),
          q('w0q1', '3', 1, 'A 2-year-old boy presents with a fever and rash'),
          q('w0q2', '4', 1, 'A 2-year-old boy presents with'),
        ],
        pages: [],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['2', '3', '4'])
    expect(result.drops).toEqual([])
  })

  it('still deduplicates the same question observed by two windows across the overlap', () => {
    const windows: IndexWindow[] = [
      { questions: [q('w0q0', '30', 10, 'A 25-year-old man presents with chest pain')], pages: [] },
      { questions: [q('w1q0', '30', 10, 'A 25-year-old man presents with chest pain')], pages: [] },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
    expect(result.drops).toEqual([
      { ref: 'w1q0', printedLabel: '30', ownerPage: 10, rule: 'duplicate_label', twinRef: 'w0q0' },
    ])
  })

  it('rescues a disowned observation when no window emitted anything for that page', () => {
    // Regression: questions 58-60 sat on the last page of window 2's core.
    // Window 2 emitted nothing there; window 3 read them across the overlap
    // and correctly disowned them, so both windows dropped them silently.
    const windows = [
      { questions: [q('w1q0', '57', 19, 'A 40-year-old woman')], pages: [], disowned: [] },
      {
        questions: [q('w2q3', '61', 21, 'A 12-year-old girl')],
        pages: [],
        disowned: [
          q('w2q0', '58', 20, 'A 47-year-old man'),
          q('w2q1', '59', 20, 'A 48-year-old man'),
          q('w2q2', '60', 20, 'A 48-year-old woman'),
        ],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['57', '58', '59', '60', '61'])
  })

  it('drops a disowned observation the owning window already emitted', () => {
    const windows = [
      { questions: [q('w0q0', '18', 10, 'A 40-year-old woman')], pages: [], disowned: [] },
      { questions: [], pages: [], disowned: [q('w1q0', '18', 10, 'A 40-year-old woman')] },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
    expect(result.drops).toEqual([
      { ref: 'w1q0', printedLabel: '18', ownerPage: 10, rule: 'duplicate_label', twinRef: 'w0q0' },
    ])
  })

  it('rescues the questions an owning window missed on a page it partly covered', () => {
    // The real failure: the owner read 55-57 off the last page of its core and
    // stopped. A page is not all-or-nothing, so a page-level "is it covered"
    // test loses 58-60 even though the next window read them correctly.
    const windows = [
      {
        questions: [q('w1q0', '55', 20, 'A 44-year-old man'), q('w1q1', '56', 20, 'A 45-year-old man')],
        pages: [],
        disowned: [],
      },
      {
        questions: [q('w2q3', '61', 21, 'A 12-year-old girl')],
        pages: [],
        disowned: [q('w2q0', '58', 20, 'A 47-year-old man'), q('w2q1', '59', 20, 'A 48-year-old man')],
      },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.map((r: ReconciledQuestion) => r.printedLabel)).toEqual(['55', '56', '58', '59', '61'])
  })

  it('does not rescue an unnumbered generic-anchor observation onto a covered page', () => {
    // No identity strong enough to recognise a duplicate, so the conservative
    // page test still applies rather than risk a duplicated row.
    const windows = [
      { questions: [q('w0q0', '', 10, 'Which of the following')], pages: [], disowned: [] },
      { questions: [], pages: [], disowned: [q('w1q0', '', 10, 'Which of the following')] },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
    expect(result.drops.map((d) => d.rule)).toEqual(['page_not_owned'])
  })

  it('rescues an uncovered page from only one window when two can see it', () => {
    const windows = [
      { questions: [], pages: [], disowned: [q('w0q0', '40', 12, 'A 30-year-old man')] },
      { questions: [], pages: [], disowned: [q('w1q0', '40', 12, 'A 30-year-old man')] },
    ]
    const result = reconcileIndexWindows(windows)
    expect(result.questions.length).toBe(1)
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
