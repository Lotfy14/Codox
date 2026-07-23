import { describe, expect, it } from 'vitest'
import { validateAgentExam } from './manifest'

const PAGES = [
  { index: 0, file: 'pages/page-001.jpg', width: 1000, height: 1400, role: 'exam' },
  { index: 1, file: 'pages/page-002.jpg', width: 1000, height: 1400, role: 'answer-key' },
]

const FILES = new Set([
  'exam.json',
  'pages/page-001.jpg',
  'pages/page-002.jpg',
  'images/fig-01.jpg',
])

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    codoxAgentBundle: 1,
    sourceFile: 'Exam.pdf',
    producedBy: 'test-model',
    pages: PAGES,
    figures: [
      { id: 'fig-01', file: 'images/fig-01.jpg', page: 1, box: [100, 100, 400, 400] },
    ],
    topics: [{ topic: 'Cardiology', subtopics: ['Arrhythmia'] }],
    questions: [question()],
    ...overrides,
  }
}

function question(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q001',
    question: 'Which vessel?',
    options: ['Aorta', 'Vena cava'],
    answer: { source: 'extracted', index: 0, evidence: 'answer column' },
    figures: ['fig-01'],
    topic: 'Cardiology',
    subtopic: 'Arrhythmia',
    year: '2024',
    page: 1,
    box: [50, 50, 500, 900],
    flag: '',
    groupId: '',
    ...overrides,
  }
}

function validate(overrides: Record<string, unknown> = {}) {
  return validateAgentExam(bundle(overrides), FILES)
}

describe('validateAgentExam', () => {
  it('accepts a complete bundle', () => {
    const result = validate()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.exam.questions[0].answer).toEqual({
      source: 'extracted',
      index: 0,
      evidence: 'answer column',
    })
    expect(result.exam.figures[0].box).toEqual([100, 100, 400, 400])
    expect(result.exam.topics).toEqual([
      { topic: 'Cardiology', subtopics: ['Arrhythmia'] },
    ])
  })

  it('rejects a bundle from a future contract version', () => {
    const result = validateAgentExam(bundle({ codoxAgentBundle: 2 }), FILES)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('codoxAgentBundle must be 1')
  })

  it.each([
    ['duplicate ids', { questions: [question(), question()] }, 'duplicate id'],
    ['a reserved ~ in an id', { questions: [question({ id: 'q1~m2' })] }, 'reserved'],
    ['an empty id', { questions: [question({ id: '  ' })] }, 'id is required'],
    ['empty question text', { questions: [question({ question: ' ' })] }, 'empty question text'],
    ['a page nobody rendered', { questions: [question({ page: 9 })] }, 'names no rendered page'],
    [
      'a degenerate question box',
      { questions: [question({ box: [500, 50, 100, 900] })] },
      'positive extent',
    ],
    [
      'a figure file that is not in the folder',
      {
        figures: [
          { id: 'fig-01', file: 'images/missing.jpg', page: 1, box: [1, 1, 2, 2] },
        ],
      },
      'is not in the folder',
    ],
    [
      'a non-JPEG figure',
      {
        figures: [
          { id: 'fig-01', file: 'images/fig-01.png', page: 1, box: [1, 1, 2, 2] },
        ],
      },
      'must be a .jpg',
    ],
  ])('rejects %s', (_label, overrides, expected) => {
    const result = validate(overrides)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain(expected)
  })

  it('flags a question with fewer than two options instead of rejecting it', () => {
    const result = validate({ questions: [question({ options: ['Only one'] })] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exam.questions[0].flag).toBe('not_mcq')
    expect(result.warnings.join('\n')).toContain('fewer than two options')
  })

  it('blanks an extracted answer whose index names no option', () => {
    const result = validate({
      questions: [question({ answer: { source: 'extracted', index: 7 } })],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exam.questions[0].answer).toEqual({ source: 'none', index: null })
    expect(result.warnings.join('\n')).toContain('left blank for review')
  })

  it('defaults a reasoned answer to likely confidence', () => {
    const result = validate({
      questions: [question({ answer: { source: 'reasoned', index: 1 } })],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exam.questions[0].answer.confidence).toBe('likely')
  })

  it('drops a link to a figure that was never declared', () => {
    const result = validate({ questions: [question({ figures: ['fig-99'] })] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exam.questions[0].figures).toEqual([])
    expect(result.warnings.join('\n')).toContain('unknown figure')
  })

  it('normalizes backslash paths so a Windows-written manifest validates', () => {
    const result = validate({
      pages: [{ ...PAGES[0], file: '.\\pages\\page-001.jpg' }, PAGES[1]],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exam.pages[0].file).toBe('pages/page-001.jpg')
  })
})
