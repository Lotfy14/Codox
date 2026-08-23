export type Box2d = readonly [number, number, number, number]

export interface GypsumQuestion {
  id: string
  topic: string
  subtopic: string
  year: string
  question: string
  options: string[]
  correct_index: string
  image_urls: string[]
  needs_review: string
  source_page?: number
  source_box?: Box2d
}

export interface ExtractedQuestion {
  label: string
  question: string
  options: string[]
  sourcePages: number[]
  questionBox: Box2d | null
  needsReview: string
}

export interface ExtractedFigure {
  page: number
  linkedLabels: string[]
  box: Box2d
  kind: string
  anchor: string
}

export interface GypsumCropLink extends ExtractedFigure {
  path: string
}

export interface PageExtraction {
  corePage: number
  declaredLabels: string[]
  questions: ExtractedQuestion[]
  figures: ExtractedFigure[]
  issues: string[]
}

export interface PrintedAnswer {
  label: string
  index: string
}

export interface AuditResult {
  pass: boolean
  missingLabels: string[]
  duplicateLabels: string[]
  missingVisualLabels: string[]
  incompleteOptionLabels: string[]
  notes: string[]
}

export interface CropCheck {
  pass: boolean
  figures: ExtractedFigure[]
  issues: string[]
}
