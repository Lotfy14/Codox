import { describe, expect, it } from 'vitest'
import type { MergedRow } from '../engine/types'
import type { ReviewRow } from './review-data'
import {
  filterReviewRows,
  isUnresolvedFlag,
  jumpIndex,
  parseSearch,
} from './review-filter'

function makeReviewRow(
  id: string,
  questionNumber: number,
  overrides: Partial<MergedRow> = {},
  flagged = false,
): ReviewRow {
  return {
    row: {
      id,
      group_id: '',
      topic: '',
      subtopic: '',
      year: '',
      question: `Question ${questionNumber}`,
      options: ['Alpha', 'Beta'],
      correct_index: flagged ? '' : '0',
      image_urls: [],
      needs_review: flagged ? 'no_answer_key' : '',
      ...overrides,
    },
    questionNumber,
    category: flagged ? 'blank-answer' : null,
    pageIndex: null,
    box: null,
  }
}

const rows = [
  makeReviewRow('one', 1),
  makeReviewRow('two', 2, { question: 'A special prompt' }, true),
  makeReviewRow('three', 3, { options: ['Gamma', 'Needle option'] }),
]

describe('parseSearch', () => {
  it('parses empty, jump, and text queries', () => {
    expect(parseSearch('')).toEqual({ kind: 'none' })
    expect(parseSearch('   ')).toEqual({ kind: 'none' })
    expect(parseSearch(' 002 ')).toEqual({ kind: 'jump', questionNumber: 2 })
    expect(parseSearch('  SPecial ')).toEqual({ kind: 'text', text: 'special' })
  })
})

describe('review filtering', () => {
  it('combines needs-review and text matching across questions and options', () => {
    expect(filterReviewRows(rows, 'all', parseSearch('needle'), {})).toEqual([rows[2]])
    expect(filterReviewRows(rows, 'needs-review', parseSearch('special'), {})).toEqual([rows[1]])
  })

  it('honors valid resolutions and ignores invalid ones', () => {
    expect(filterReviewRows(rows, 'needs-review', parseSearch(''), { two: 1 })).toEqual([])
    expect(filterReviewRows(rows, 'needs-review', parseSearch(''), { two: 9 })).toEqual([rows[1]])
    expect(isUnresolvedFlag(rows[1], {})).toBe(true)
    expect(isUnresolvedFlag(rows[1], { two: 0 })).toBe(false)
    expect(isUnresolvedFlag(rows[0], {})).toBe(false)
  })

  it('does not filter jump queries and resolves present or hidden targets', () => {
    const all = filterReviewRows(rows, 'all', parseSearch('3'), {})
    const flagged = filterReviewRows(rows, 'needs-review', parseSearch('3'), {})
    expect(all).toEqual(rows)
    expect(jumpIndex(all, 3)).toBe(2)
    expect(jumpIndex(flagged, 3)).toBe(-1)
    expect(jumpIndex(all, 99)).toBe(-1)
  })
})
