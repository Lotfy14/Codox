import { describe, expect, it } from 'vitest'
import { estimatedMinutes, needsAnswerKeyFile } from './convert-logic'

describe('needsAnswerKeyFile', () => {
  it('is false with no files regardless of the batch default', () => {
    expect(needsAnswerKeyFile('key-file', [])).toBe(false)
  })

  it('is true when the batch default is key-file and a file follows it', () => {
    expect(needsAnswerKeyFile('key-file', [{}, { answerSource: 'inside' }])).toBe(
      true,
    )
  })

  it('is false when every file overrides a key-file batch default', () => {
    expect(
      needsAnswerKeyFile('key-file', [
        { answerSource: 'inside' },
        { answerSource: 'none' },
      ]),
    ).toBe(false)
  })

  it('is true when any file explicitly declares key-file', () => {
    expect(needsAnswerKeyFile('inside', [{}, { answerSource: 'key-file' }])).toBe(
      true,
    )
  })

  it('is false for inside/none declarations', () => {
    expect(needsAnswerKeyFile('inside', [{}])).toBe(false)
    expect(needsAnswerKeyFile('none', [{ answerSource: 'inside' }])).toBe(false)
  })
})

describe('estimatedMinutes', () => {
  it('never estimates below one minute', () => {
    expect(estimatedMinutes(0)).toBe(1)
    expect(estimatedMinutes(3)).toBe(1)
  })

  it('estimates ~5 s per page', () => {
    expect(estimatedMinutes(25)).toBe(2)
    expect(estimatedMinutes(60)).toBe(5)
  })
})
