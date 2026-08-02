import { describe, expect, it } from 'vitest'
import { parseBoxResult, parseIndexWindow } from './index-pass'

const BOX = [10, 20, 100, 200]
const ANOTHER_BOX = [150, 160, 300, 320]

const INDEX_QUESTION = {
  ref: 'w0q0', printed_label: '1', owner_page: 1, source_pages: [1],
  anchor: 'At which site', options_present: true, case_stem_key: null,
  section_hint: '', visible_year: '',
}
const INDEX_PAGE = {
  page: 1, contains_question_start: true, first_printed_label: '1',
  last_printed_label: '1', section_hint: '',
}

describe('parseIndexWindow answer_present', () => {
  it('reads the answer_present boolean', () => {
    const result = parseIndexWindow(JSON.stringify({
      questions: [{ ...INDEX_QUESTION, answer_present: true }],
      pages: [INDEX_PAGE],
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.questions[0].answerPresent).toBe(true)
  })

  it('maps a legacy evidence_state checkpoint: inline -> true, else false', () => {
    const inline = parseIndexWindow(JSON.stringify({
      questions: [{ ...INDEX_QUESTION, evidence_state: 'inline' }], pages: [INDEX_PAGE],
    }))
    const none = parseIndexWindow(JSON.stringify({
      questions: [{ ...INDEX_QUESTION, evidence_state: 'none' }], pages: [INDEX_PAGE],
    }))
    expect(inline.ok && inline.value.questions[0].answerPresent).toBe(true)
    expect(none.ok && none.value.questions[0].answerPresent).toBe(false)
  })

  it('rejects a question missing both answer_present and evidence_state', () => {
    const result = parseIndexWindow(JSON.stringify({
      questions: [{ ...INDEX_QUESTION }], pages: [INDEX_PAGE],
    }))
    expect(result.ok).toBe(false)
  })
})

describe('parseBoxResult', () => {
  it('accepts regions whose page is 0 — the executor overwrites it (regression)', () => {
    const text = JSON.stringify({
      questions: [
        {
          ref: 'Q1',
          question: { page: 0, box_2d: BOX },
          options: { page: 0, box_2d: ANOTHER_BOX },
          case_stem: null,
          inline_evidence: { page: 0, box_2d: [5, 5, 50, 50] },
        },
      ],
      figures: [],
    })
    const result = parseBoxResult(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.questions).toHaveLength(1)
      const q = result.value.questions[0]
      expect(q.question).not.toBeNull()
      expect(q.question.page).toBe(0)
      expect(q.options).not.toBeNull()
      expect(q.inlineEvidence).not.toBeNull()
    }
  })

  it('skips an invalid question instead of failing the whole page', () => {
    const text = JSON.stringify({
      questions: [
        {
          ref: 'Q2',
          question: { page: 0 },
          options: null,
          case_stem: null,
          inline_evidence: null,
        },
      ],
      figures: [],
    })
    const result = parseBoxResult(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.questions).toHaveLength(0)
    }
  })

  it('keeps valid questions alongside invalid ones', () => {
    const text = JSON.stringify({
      questions: [
        { ref: 'Q1', question: { page: 1, box_2d: [10, 20, 100, 200] }, options: null, case_stem: null, inline_evidence: null },
        { ref: 'Q2', question: { page: 0 }, options: null, case_stem: null, inline_evidence: null },
      ],
      figures: [],
    })
    const result = parseBoxResult(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.questions).toHaveLength(1)
      expect(result.value.questions[0].ref).toBe('Q1')
    }
  })

  it('accepts null options and case_stem regions', () => {
    const text = JSON.stringify({
      questions: [
        {
          ref: 'Q3',
          question: { page: 1, box_2d: BOX },
          options: null,
          case_stem: null,
          inline_evidence: null,
        },
      ],
      figures: [],
    })
    const result = parseBoxResult(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const q = result.value.questions[0]
      expect(q.options).toBeNull()
      expect(q.caseStem).toBeNull()
      expect(q.inlineEvidence).toBeNull()
    }
  })
})