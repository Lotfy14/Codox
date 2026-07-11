/**
 * Fake data for the Phase 3 clickable mockups. Nothing here is persisted;
 * every value exists so the owner can judge real layouts with real-looking
 * content.
 */
import type { ProviderOrderItem } from '../design/components'
import type { FileAnswerSource } from '../design/components'

export interface MockFile {
  answerSource?: FileAnswerSource
  id: string
  name: string
  pages: number
  size: number
}

export interface MockRun {
  date: string
  exported: boolean
  flagsLeft: number
  id: string
  keptOriginal: boolean
  name: string
  questions: number
  size: number
}

export type FlagReason =
  | 'blank-answer'
  | 'conflicting-marks'
  | 'length-mismatch'
  | 'low-confidence'

export interface MockFlag {
  id: string
  options: readonly string[]
  page: number
  question: string
  questionNumber: number
  reason: FlagReason
  /** Fake "scanned page" lines rendered inside the source crop. */
  sourceLines: readonly string[]
  /** Which option the scan appears to mark, when any (index into options). */
  suggestedIndex?: number
}

/** One on-device storage picture, shared by every surface that shows it. */
export const storageUsage = {
  total: 524_288_000,
  used: 126_353_408,
} as const

export const sampleFiles: readonly MockFile[] = [
  { id: 'bio', name: 'bio_exam.pdf', pages: 12, size: 4_718_592 },
  { id: 'maths', name: 'maths_mock.pdf', pages: 9, size: 2_359_296 },
]

export const initialProviders: readonly ProviderOrderItem[] = [
  {
    id: 'groq',
    name: 'Groq',
    description: 'Fast free tier · good first choice',
    status: 'working',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Free models · takes over when Groq rests',
    status: 'idle',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Large free allowance',
    status: 'idle',
  },
]

export const recentRuns: readonly MockRun[] = [
  {
    id: 'run-derm',
    name: 'derm_finals.pdf',
    date: 'Yesterday',
    exported: false,
    flagsLeft: 2,
    keptOriginal: true,
    questions: 84,
    size: 6_291_456,
  },
  {
    id: 'run-im',
    name: 'internal_med_2.pdf',
    date: 'Tuesday',
    exported: true,
    flagsLeft: 0,
    keptOriginal: false,
    questions: 127,
    size: 9_437_184,
  },
  {
    id: 'run-anatomy',
    name: 'anatomy_quiz.pdf',
    date: 'Last week',
    exported: true,
    flagsLeft: 0,
    keptOriginal: true,
    questions: 45,
    size: 3_145_728,
  },
]

export const reviewFlags: readonly MockFlag[] = [
  {
    id: 'flag-1',
    questionNumber: 14,
    page: 3,
    reason: 'blank-answer',
    question:
      'Which of the following is the most common cause of community-acquired pneumonia in adults?',
    options: [
      'Streptococcus pneumoniae',
      'Haemophilus influenzae',
      'Mycoplasma pneumoniae',
      'Klebsiella pneumoniae',
    ],
    sourceLines: [
      '14. Which of the following is the most common cause of',
      '    community-acquired pneumonia in adults?',
      '    A) Streptococcus pneumoniae',
      '    B) Haemophilus influenzae',
      '    C) Mycoplasma pneumoniae',
      '    D) Klebsiella pneumoniae',
    ],
  },
  {
    id: 'flag-2',
    questionNumber: 22,
    page: 5,
    reason: 'conflicting-marks',
    question:
      'A 45-year-old presents with right lower quadrant pain. Which sign suggests appendicitis?',
    options: [
      "Murphy's sign",
      "Rovsing's sign",
      "Cullen's sign",
      "Kehr's sign",
    ],
    suggestedIndex: 1,
    sourceLines: [
      '22. A 45-year-old presents with right lower quadrant pain.',
      '    Which sign suggests appendicitis?',
      "    A) Murphy's sign        ✗",
      "    B) Rovsing's sign       ✓",
      "    C) Cullen's sign        ✓",
      "    D) Kehr's sign",
    ],
  },
  {
    id: 'flag-3',
    questionNumber: 31,
    page: 7,
    reason: 'low-confidence',
    question:
      'Which vitamin deficiency causes peripheral neuropathy and megaloblastic anemia?',
    options: ['Vitamin B1', 'Vitamin B6', 'Vitamin B12', 'Vitamin D'],
    sourceLines: [
      '31. Which vitamin deficiency causes peripheral neuro-',
      '    pathy and megaloblastic anemia?',
      '    A) Vitamin B1      B) Vitamin B6',
      '    C) Vitamin B12     D) Vitamin D',
      '    [smudged handwriting near option C]',
    ],
  },
  {
    id: 'flag-4',
    questionNumber: 38,
    page: 9,
    reason: 'length-mismatch',
    question: 'First-line treatment for uncomplicated urinary tract infection?',
    options: ['Nitrofurantoin', 'Amoxicillin', 'Ciprofloxacin'],
    sourceLines: [
      '38. First-line treatment for uncomplicated urinary',
      '    tract infection?',
      '    A) Nitrofurantoin',
      '    B) Amoxicillin',
      '    C) Ciprofloxacin',
      '    D) [text cut off at page edge]',
    ],
  },
]
