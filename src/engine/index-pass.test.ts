import { describe, expect, it } from 'vitest'
import { parseBoxResult } from './index-pass'

const BOX = [10, 20, 100, 200]
const ANOTHER_BOX = [150, 160, 300, 320]

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