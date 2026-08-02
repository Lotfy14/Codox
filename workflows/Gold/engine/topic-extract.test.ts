import { describe, expect, it } from 'vitest'
import { isTopicsImage, narrowExtractedTopics } from './topic-extract'

describe('narrowExtractedTopics', () => {
  it('accepts a clean transcription', () => {
    expect(
      narrowExtractedTopics({
        topics: [
          { topic: 'Surgery', subtopics: ['Appendix', 'Gallbladder'] },
          { topic: 'Pediatrics', subtopics: [] },
        ],
      }),
    ).toEqual([
      { topic: 'Surgery', subtopics: ['Appendix', 'Gallbladder'] },
      { topic: 'Pediatrics', subtopics: [] },
    ])
  })

  it('trims, drops empties, and dedupes topics and subtopics', () => {
    expect(
      narrowExtractedTopics({
        topics: [
          { topic: '  Surgery ', subtopics: [' Appendix', 'Appendix', ' ', ''] },
          { topic: 'Surgery', subtopics: ['Other'] },
          { topic: '   ', subtopics: [] },
        ],
      }),
    ).toEqual([{ topic: 'Surgery', subtopics: ['Appendix'] }])
  })

  it('caps runaway lists', () => {
    const huge = {
      topics: Array.from({ length: 400 }, (_, i) => ({
        topic: `Topic ${i}`,
        subtopics: Array.from({ length: 80 }, (_, j) => `Sub ${j}`),
      })),
    }
    const narrowed = narrowExtractedTopics(huge)
    expect(narrowed).toHaveLength(300)
    expect(narrowed?.[0].subtopics).toHaveLength(50)
  })

  it.each([
    ['not a record', 'nope'],
    ['topics not an array', { topics: 'nope' }],
    ['entry missing topic', { topics: [{ subtopics: [] }] }],
    ['topic not a string', { topics: [{ topic: 7, subtopics: [] }] }],
    ['subtopics not strings', { topics: [{ topic: 'A', subtopics: [1] }] }],
    ['subtopics missing', { topics: [{ topic: 'A' }] }],
  ])('rejects malformed shape: %s', (_name, value) => {
    expect(narrowExtractedTopics(value)).toBeUndefined()
  })

  it('an empty transcription is valid (no list found in the document)', () => {
    expect(narrowExtractedTopics({ topics: [] })).toEqual([])
  })
})

describe('isTopicsImage', () => {
  it('accepts png/jpeg/webp and nothing else', () => {
    expect(isTopicsImage('image/png')).toBe(true)
    expect(isTopicsImage('image/jpeg')).toBe(true)
    expect(isTopicsImage('image/webp')).toBe(true)
    expect(isTopicsImage('application/pdf')).toBe(false)
    expect(isTopicsImage('image/gif')).toBe(false)
  })
})
