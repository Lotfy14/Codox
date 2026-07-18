import { describe, expect, it } from 'vitest'
import { parentRowId, splitRow, validateMatchingResponse } from './matching'
import type { MergedRow } from './types'

function makeRow(overrides: Partial<MergedRow> = {}): MergedRow {
  return {
    id: '12',
    group_id: 'group01',
    topic: '',
    subtopic: '',
    year: '',
    question:
      'Match each drug with its mechanism of action:\n1. Aspirin\n2. Metformin\n3. Warfarin',
    options: [
      'COX inhibitor',
      'Vitamin K antagonist',
      'Biguanide',
      'DPP-4 inhibitor',
    ],
    correct_index: '',
    image_urls: [],
    needs_review: '',
    ...overrides,
  }
}

const GOOD_RESPONSE = JSON.stringify({
  rows: [
    {
      id: '12',
      is_matching: true,
      instruction: 'Match each drug with its mechanism of action:',
      items: ['Aspirin', 'Metformin', 'Warfarin'],
      options: [
        'COX inhibitor',
        'Vitamin K antagonist',
        'Biguanide',
        'DPP-4 inhibitor',
      ],
    },
  ],
})

describe('parentRowId', () => {
  it('recovers the source row a split row came from', () => {
    expect(parentRowId('12~m3')).toBe('12')
  })

  it('leaves an ordinary row id alone', () => {
    expect(parentRowId('12')).toBe('12')
  })
})

describe('validateMatchingResponse', () => {
  it('accepts a split whose every span was copied from the row', () => {
    const result = validateMatchingResponse(GOOD_RESPONSE, [makeRow()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.splits.get('12')?.items).toEqual([
      'Aspirin',
      'Metformin',
      'Warfarin',
    ])
  })

  it('drops a row whose option the model invented (NEVER-GUESS)', () => {
    // "Incretin degradation blockade" is nowhere in the source row — the
    // model authored it. The row must survive untouched instead.
    const authored = JSON.stringify({
      rows: [
        {
          id: '12',
          is_matching: true,
          instruction: 'Match each drug with its mechanism of action:',
          items: ['Aspirin', 'Metformin', 'Warfarin'],
          options: ['COX inhibitor', 'Incretin degradation blockade'],
        },
      ],
    })
    const result = validateMatchingResponse(authored, [makeRow()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.splits.size).toBe(0)
  })

  it('drops a row whose item was reworded rather than copied', () => {
    const reworded = JSON.stringify({
      rows: [
        {
          id: '12',
          is_matching: true,
          instruction: '',
          items: ['Acetylsalicylic acid', 'Metformin'],
          options: ['COX inhibitor', 'Biguanide'],
        },
      ],
    })
    const result = validateMatchingResponse(reworded, [makeRow()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.splits.size).toBe(0)
  })

  it('ignores a row the model reports as not matching', () => {
    const notMatching = JSON.stringify({
      rows: [{ id: '12', is_matching: false }],
    })
    const result = validateMatchingResponse(notMatching, [makeRow()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.splits.size).toBe(0)
  })

  it('drops a claimed match with only one item — not a real pairing', () => {
    const thin = JSON.stringify({
      rows: [
        {
          id: '12',
          is_matching: true,
          instruction: '',
          items: ['Aspirin'],
          options: ['COX inhibitor', 'Biguanide'],
        },
      ],
    })
    const result = validateMatchingResponse(thin, [makeRow()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.splits.size).toBe(0)
  })

  it('rejects a response naming a row that was never sent', () => {
    const stray = JSON.stringify({
      rows: [{ id: '99', is_matching: false }],
    })
    const result = validateMatchingResponse(stray, [makeRow()])
    expect(result.ok).toBe(false)
  })

  it('rejects a response that is not the contract shape', () => {
    expect(validateMatchingResponse('{"nope":1}', [makeRow()]).ok).toBe(false)
    expect(validateMatchingResponse('not json', [makeRow()]).ok).toBe(false)
  })
})

describe('splitRow', () => {
  const split = {
    id: '12',
    instruction: 'Match each drug with its mechanism of action:',
    items: ['Aspirin', 'Metformin'],
    options: ['COX inhibitor', 'Biguanide'],
  }

  it('emits one row per item, each carrying the full option list', () => {
    const rows = splitRow(makeRow(), split)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.id)).toEqual(['12~m1', '12~m2'])
    expect(rows[0].question).toBe(
      'Match each drug with its mechanism of action:\n\nMatch: Aspirin',
    )
    expect(rows[1].options).toEqual(['COX inhibitor', 'Biguanide'])
  })

  it('never carries an answer — the pairing was never read from the page', () => {
    const answered = makeRow({ correct_index: '0' })
    for (const row of splitRow(answered, split)) {
      expect(row.correct_index).toBe('')
      expect(row.needs_review).not.toBe('')
    }
  })

  it('keeps the parent group and figures so split rows stay together', () => {
    const withFigure = makeRow({ image_urls: ['images/asset01.jpg'] })
    for (const row of splitRow(withFigure, split)) {
      expect(row.group_id).toBe('group01')
      expect(row.image_urls).toEqual(['images/asset01.jpg'])
    }
  })

  it('falls back to the bare label when no instruction was copied', () => {
    const rows = splitRow(makeRow(), { ...split, instruction: '' })
    expect(rows[0].question).toBe('Match: Aspirin')
  })

  it('preserves an existing review flag rather than overwriting it', () => {
    const flagged = makeRow({ needs_review: 'no_answer_key' })
    expect(splitRow(flagged, split)[0].needs_review).toBe('no_answer_key')
  })
})
