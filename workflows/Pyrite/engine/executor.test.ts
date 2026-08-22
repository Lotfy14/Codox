import { describe, expect, it } from 'vitest'
import { dedupe, fillSections, stitchContinuations } from './executor'

type Row = Parameters<typeof dedupe>[0][number]

function row(overrides: Partial<Row> = {}): Row {
  return {
    label: '', section: '', sourcePages: [1], question: 'Question?',
    options: ['A. One', 'B. Two'], correctIndex: '', needsReview: '',
    continuation: false, sourceBox: null,
    ...overrides,
  }
}

describe('Pyrite page continuations', () => {
  it('joins next-page choices and offsets a selected continued option', () => {
    const rows = stitchContinuations([
      row({
        label: '19', sourcePages: [3], question: 'Question split across pages?',
        options: ['A. First', 'B. Second'], needsReview: 'options_cut_at_page_break',
        sourceBox: [500, 50, 900, 950],
      }),
      row({
        label: '', sourcePages: [4], question: '',
        options: ['C. Third', 'D. Fourth'], correctIndex: '1',
        continuation: true, sourceBox: [0, 50, 180, 950],
      }),
      row({
        label: '20', sourcePages: [4], question: 'Next question',
        options: ['A. One', 'B. Two'], correctIndex: '0', sourceBox: [200, 50, 600, 950],
      }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      label: '19', sourcePages: [3, 4],
      options: ['A. First', 'B. Second', 'C. Third', 'D. Fourth'],
      correctIndex: '3', needsReview: '',
    })
    expect(rows[1]?.label).toBe('20')
  })

  it('flags a continuation instead of welding it onto a complete question', () => {
    // The model names the stem's page beside the page the choices are printed
    // on, so this row's "[2,3]" describes choices on page 3. Searching from
    // sourcePages[0] looked for a stem on page 1 and hung them on question 2.
    const rows = stitchContinuations([
      row({ label: '2', sourcePages: [1], options: ['A. One', 'B. Two', 'C. Three', 'D. Four'] }),
      row({ label: '6', sourcePages: [2], options: ['A. One', 'B. Two', 'C. Three', 'D. Four'] }),
      row({
        label: '', sourcePages: [2, 3], question: '',
        options: ['Aortic stenosis.', 'Mitral regurge.', 'Pulmonary embolism.', 'Pulmonary stenosis.'],
        continuation: true,
      }),
    ])

    expect(rows).toHaveLength(3)
    expect(rows[0]?.options).toHaveLength(4)
    expect(rows[1]?.options).toHaveLength(4)
    expect(rows[2]).toMatchObject({ continuation: true, needsReview: 'orphaned_page_continuation' })
  })

  it('drops a continuation the stem already read across the break', () => {
    const tail = ['Cancer colon.', 'Inflammatory bowel disease.', 'Irritable bowel disease.', 'Diverticular disease.']
    const rows = stitchContinuations([
      row({ label: '22', sourcePages: [6, 7], question: 'Recurrent abdominal pain?', options: tail }),
      row({ label: '', sourcePages: [6, 7], question: '', options: tail, continuation: true }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: '22', options: tail, sourcePages: [6, 7] })
  })
})

describe('Pyrite look-ahead deduplication', () => {
  it('removes a repeated question even when its second label is missing', () => {
    const rows = dedupe([
      row({
        label: '80', sourcePages: [8], question: 'In hydrocephalus before closure of fontanelles, there is:',
        correctIndex: '1', sourceBox: [100, 50, 300, 950],
      }),
      row({
        label: '', sourcePages: [9], question: 'In hydrocephalus before closure of fontanelles, there is:',
        correctIndex: '1', sourceBox: [100, 50, 300, 950],
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('80')
  })

  it('keeps both questions when a later section reuses a printed number', () => {
    const rows = dedupe([
      row({ label: '3', section: 'a', sourcePages: [2], question: 'Severe microcytic hypochromic anemia?' }),
      row({ label: '3', section: 'b', sourcePages: [8], question: 'Correct fluid loss in ketoacidosis?', correctIndex: '0' }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((entry) => entry.id)).toEqual(['3', '3#2'])
    expect(rows[0]?.question).toBe('Severe microcytic hypochromic anemia?')
  })

  it('separates reused numbers by page distance when no heading was read', () => {
    // Without a heading the pages still tell the two apart: a look-ahead
    // re-read is never more than one page from the first sighting, and the
    // answered row would otherwise have overwritten the unanswered one.
    const rows = dedupe([
      row({ label: '17', sourcePages: [5], question: 'Generalized fatigue and dark urine?' }),
      row({ label: '17', sourcePages: [11], question: 'Regarding anti-nuclear antibody:', correctIndex: '3' }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((entry) => entry.id)).toEqual(['17', '17#2'])
  })
})

describe('Pyrite section headings', () => {
  it('carries a heading onto the later pages printed beneath it', () => {
    // Only the window that renders page 1 sees "Section A"; the window that
    // covers pages 5-7 answers with an empty section for the same section.
    const filled = fillSections([
      [row({ label: '1', section: 'a', sourcePages: [1] })],
      [row({ label: '17', sourcePages: [5] })],
      [row({ label: '1', section: 'b', sourcePages: [8] })],
      [row({ label: '17', sourcePages: [11] })],
    ])

    expect(filled.flat().map((entry) => entry.section)).toEqual(['a', 'a', 'b', 'b'])
  })

  it('leaves a row that read its own heading alone', () => {
    const filled = fillSections([[
      row({ label: '1', section: 'a', sourcePages: [1] }),
      row({ label: '1', section: 'b', sourcePages: [2] }),
    ]])

    expect(filled[0]?.map((entry) => entry.section)).toEqual(['a', 'b'])
  })
})
