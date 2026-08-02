import { describe, expect, it } from 'vitest'
import { dedupe, stitchContinuations } from './executor'

describe('Pyrite page continuations', () => {
  it('joins next-page choices and offsets a selected continued option', () => {
    const rows = stitchContinuations([
      {
        label: '19', sourcePages: [3], question: 'Question split across pages?',
        options: ['A. First', 'B. Second'], correctIndex: '',
        needsReview: 'options_cut_at_page_break', continuation: false, sourceBox: [500, 50, 900, 950],
      },
      {
        label: '', sourcePages: [4], question: '',
        options: ['C. Third', 'D. Fourth'], correctIndex: '1',
        needsReview: '', continuation: true, sourceBox: [0, 50, 180, 950],
      },
      {
        label: '20', sourcePages: [4], question: 'Next question',
        options: ['A. One', 'B. Two'], correctIndex: '0',
        needsReview: '', continuation: false, sourceBox: [200, 50, 600, 950],
      },
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      label: '19', sourcePages: [3, 4],
      options: ['A. First', 'B. Second', 'C. Third', 'D. Fourth'],
      correctIndex: '3', needsReview: '',
    })
    expect(rows[1].label).toBe('20')
  })
})

describe('Pyrite look-ahead deduplication', () => {
  it('removes a repeated question even when its second label is missing', () => {
    const rows = dedupe([
      {
        label: '80', sourcePages: [8], question: 'In hydrocephalus before closure of fontanelles, there is:',
        options: ['A. One', 'B. Two'], correctIndex: '1', needsReview: '', continuation: false, sourceBox: [100, 50, 300, 950],
      },
      {
        label: '', sourcePages: [9], question: 'In hydrocephalus before closure of fontanelles, there is:',
        options: ['A. One', 'B. Two'], correctIndex: '1', needsReview: '', continuation: false, sourceBox: [100, 50, 300, 950],
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('80')
  })
})
