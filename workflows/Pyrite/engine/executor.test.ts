import { describe, expect, it } from 'vitest'
import { absorbOrphanContinuations, dedupe, fillSections, modalOptionCount, parseRows, stitchContinuations } from './executor'

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

describe('Pyrite window page numbering', () => {
  // Roughly one response in three numbers its rows against the images it was
  // handed rather than the document pages the prompt named, which turned every
  // question on a renumbered window into a duplicate `#2` row.
  it('renumbers a response that counted from its own first image', () => {
    const rows = parseRows({
      rows: [{ label: '87', question: 'Fatty casts in urine?', options: ['A', 'B'], source_pages: [1] }],
    }, 18, 13, 15)

    expect(rows?.[0]?.sourcePages).toEqual([13])
  })

  it('leaves a response that already used document pages alone', () => {
    const rows = parseRows({
      rows: [{ label: '101', question: 'Inhaled drugs?', options: ['A', 'B'], source_pages: [15, 16] }],
    }, 18, 15, 17)

    expect(rows?.[0]?.sourcePages).toEqual([15, 16])
  })

  it('keeps a straddling question that names the page before its window', () => {
    const rows = parseRows({
      rows: [{ label: '86', question: 'Oliguria is?', options: ['A', 'B'], source_pages: [12, 13] }],
    }, 18, 13, 15)

    expect(rows?.[0]?.sourcePages).toEqual([12, 13])
  })
})

describe('Pyrite cross-window continuations', () => {
  const full = ['Morphia', 'Diazepam', 'NSAID', 'nitroglycerine']

  it('takes the answer a neighbouring window read off the continued choices', () => {
    // The stem is on page 2 and its choices on page 3. The window whose core
    // starts at page 3 never sees the stem, so its continuation row shipped as
    // an empty-question fragment holding the answer question 14 then lacked.
    const rows = absorbOrphanContinuations([
      row({ label: '14', sourcePages: [2], question: 'Drug of choice?', options: full, needsReview: 'options cut at page break' }),
      row({ label: '15', sourcePages: [3], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '16', sourcePages: [3], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '17', sourcePages: [3], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '', sourcePages: [3], question: '', options: full, correctIndex: '0', continuation: true }),
    ])

    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ label: '14', correctIndex: '0', needsReview: '' })
  })

  it('offsets an answer read off only the choices that continued', () => {
    const rows = absorbOrphanContinuations([
      row({ label: '100', sourcePages: [14], options: ['Conscious level', 'Dehydration', 'Hyperthermia', 'Air hunger'] }),
      row({ label: '101', sourcePages: [15], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '102', sourcePages: [15], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '103', sourcePages: [15], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '', sourcePages: [15], question: '', options: ['Hyperthermia', 'Air hunger'], correctIndex: '0', continuation: true }),
    ])

    expect(rows[0]).toMatchObject({ label: '100', correctIndex: '2' })
  })

  it('keeps a fragment whose choices match no stem', () => {
    const rows = absorbOrphanContinuations([
      row({ label: '5', sourcePages: [2], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '6', sourcePages: [3], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '7', sourcePages: [3], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '8', sourcePages: [3], options: ['A', 'B', 'C', 'D'] }),
      row({ label: '', sourcePages: [3], question: '', options: ['Nothing', 'Like it'], correctIndex: '0', continuation: true }),
    ])

    expect(rows).toHaveLength(5)
    expect(rows[4]).toMatchObject({ continuation: true })
  })
})

describe('Pyrite option-count norm', () => {
  it('refuses a mode drawn from too few rows to mean anything', () => {
    expect(modalOptionCount([row({ options: ['A', 'B'] }), row({ options: ['A', 'B'] })])).toBeUndefined()
  })

  it('reports the paper\'s norm once enough rows agree', () => {
    const four = ['A', 'B', 'C', 'D']
    expect(modalOptionCount([
      row({ options: four }), row({ options: four }), row({ options: four }), row({ options: ['A', 'B'] }),
    ])).toBe(4)
  })
})
