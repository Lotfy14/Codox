/** Compact, model-observed records; deterministic code turns these into a Blueprint. */
import { parseModelJson } from './json'
import type { Box2d, Region } from './types'

/** Still used by the EVIDENCE stage — a SEPARATE answer key can be ambiguous
 *  or illegible in ways the on-page binary does not need to express. */
export type EvidenceState = 'none' | 'inline' | 'separate' | 'ambiguous' | 'illegible'
export interface IndexedQuestion {
  ref: string
  printedLabel: string
  ownerPage: number
  sourcePages: number[]
  anchor: string
  optionsPresent: boolean
  caseStemKey: string | null
  sectionHint: string
  visibleYear: string
  /** Binary on-page observation: is exactly one answer visibly indicated on
   *  this question's own page? False is always left blank, never guessed;
   *  conflicting or unreadable marks are false. A separate answer key is NOT
   *  answer_present — the EVIDENCE stage handles that. */
  answerPresent: boolean
}
export interface PageManifest {
  page: number
  containsQuestionStart: boolean
  firstPrintedLabel: string
  lastPrintedLabel: string
  sectionHint: string
}
export interface IndexWindow { questions: IndexedQuestion[]; pages: PageManifest[] }
export interface FigureCandidate { page: number; linkedRefs: string[]; anchor: string }
export interface FigureDetection { figures: FigureCandidate[] }
export interface BoxedQuestion {
  ref: string
  question: Region
  options: Region | null
  caseStem: Region | null
  inlineEvidence: Region | null
}
export interface BoxedFigure { page: number; linkedRefs: string[]; box: Box2d; anchor: string }
export interface BoxResult { questions: BoxedQuestion[]; figures: BoxedFigure[] }
export interface KeyEvidence { ref: string; region: Region | null; state: EvidenceState }
export interface EvidenceMap {
  type: 'no_answer_key' | 'separate_key' | 'inline_marks' | 'mixed' | 'uncertain'
  markingStyle: string
  evidence: KeyEvidence[]
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const STATES: readonly EvidenceState[] = ['none', 'inline', 'separate', 'ambiguous', 'illegible']
const POLICY_TYPES = ['no_answer_key', 'separate_key', 'inline_marks', 'mixed', 'uncertain'] as const
function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}
function str(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function page(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
function box(value: unknown): Box2d | undefined {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number')
    ? value as unknown as Box2d : undefined
}
function region(value: unknown): Region | null | undefined {
  if (value === null) return null
  const raw = rec(value); const p = page(raw?.page); const b = box(raw?.box_2d)
  if (p === undefined || b === undefined) return undefined
  const anchor = str(raw?.anchor)
  return anchor === undefined ? { page: p, box_2d: b } : { page: p, box_2d: b, anchor }
}
/** Tolerant region for BOX-stage boxes: the model often returns `page: 0`,
 *  which the executor overwrites with the authoritative page anyway. */
function boxRegion(value: unknown): Region | null | undefined {
  if (value === null) return null
  const raw = rec(value); const b = box(raw?.box_2d)
  if (b === undefined) return undefined
  const p = page(raw?.page) ?? 0
  const anchor = str(raw?.anchor)
  return anchor === undefined ? { page: p, box_2d: b } : { page: p, box_2d: b, anchor }
}
function root(text: string): Record<string, unknown> | undefined {
  const parsed = parseModelJson(text)
  return parsed.error === undefined ? rec(parsed.value) : undefined
}

export function parseIndexWindow(text: string): ParseResult<IndexWindow> {
  const value = root(text)
  if (value === undefined || !Array.isArray(value.questions) || !Array.isArray(value.pages)) {
    return { ok: false, errors: ['index response must contain questions and pages arrays'] }
  }
  const errors: string[] = []; const questions: IndexedQuestion[] = []
  value.questions.forEach((item, index) => {
    const raw = rec(item); const ref = str(raw?.ref); const printedLabel = str(raw?.printed_label)
    const ownerPage = page(raw?.owner_page); const anchor = str(raw?.anchor)
    const optionsPresent = typeof raw?.options_present === 'boolean' ? raw.options_present : undefined
    const caseStemKey = raw?.case_stem_key === null ? null : str(raw?.case_stem_key)
    const sectionHint = str(raw?.section_hint); const visibleYear = str(raw?.visible_year)
    // New contract: answer_present boolean. Back-compat: a pre-binary
    // checkpoint carries evidence_state, where only 'inline' meant an on-page
    // answer — so it maps to true, everything else to false. Keeps an
    // interrupted old run resumable without a second INDEX call.
    const legacyState = str(raw?.evidence_state)
    const answerPresent = typeof raw?.answer_present === 'boolean'
      ? raw.answer_present
      : legacyState !== undefined && STATES.includes(legacyState as EvidenceState)
        ? legacyState === 'inline'
        : undefined
    const sourcePages = Array.isArray(raw?.source_pages)
      ? raw.source_pages.filter((p): p is number => page(p) !== undefined) : []
    if (ref === undefined || printedLabel === undefined || ownerPage === undefined || anchor === undefined ||
      optionsPresent === undefined || caseStemKey === undefined || sectionHint === undefined ||
      visibleYear === undefined || answerPresent === undefined ||
      sourcePages.length === 0) {
      errors.push('questions[' + index + '] is invalid'); return
    }
    questions.push({ ref, printedLabel, ownerPage, sourcePages: [...new Set(sourcePages)].sort((a,b) => a-b),
      anchor, optionsPresent, caseStemKey, sectionHint, visibleYear, answerPresent })
  })
  const pages: PageManifest[] = []
  value.pages.forEach((item, index) => {
    const raw = rec(item); const p = page(raw?.page)
    const starts = typeof raw?.contains_question_start === 'boolean' ? raw.contains_question_start : undefined
    const first = str(raw?.first_printed_label); const last = str(raw?.last_printed_label); const hint = str(raw?.section_hint)
    if (p === undefined || starts === undefined || first === undefined || last === undefined || hint === undefined) {
      errors.push('pages[' + index + '] is invalid'); return
    }
    pages.push({ page: p, containsQuestionStart: starts, firstPrintedLabel: first, lastPrintedLabel: last, sectionHint: hint })
  })
  return errors.length === 0 ? { ok: true, value: { questions, pages } } : { ok: false, errors }
}

export function parseFigureDetection(text: string): ParseResult<FigureDetection> {
  const value = root(text)
  if (value === undefined || !Array.isArray(value.figures)) return { ok: false, errors: ['figure response must contain figures'] }
  const errors: string[] = []; const figures: FigureCandidate[] = []
  value.figures.forEach((item, index) => {
    const raw = rec(item); const p = page(raw?.page); const anchor = str(raw?.anchor)
    const refs = Array.isArray(raw?.linked_refs) ? raw.linked_refs.filter((x): x is string => typeof x === 'string') : []
    if (p === undefined || anchor === undefined || refs.length === 0) { errors.push('figures[' + index + '] is invalid'); return }
    figures.push({ page: p, linkedRefs: refs, anchor })
  })
  return errors.length === 0 ? { ok: true, value: { figures } } : { ok: false, errors }
}

export function parseBoxResult(text: string): ParseResult<BoxResult> {
  const value = root(text)
  if (value === undefined || !Array.isArray(value.questions) || !Array.isArray(value.figures)) {
    return { ok: false, errors: ['box response must contain questions and figures'] }
  }
  const questions: BoxedQuestion[] = []; const figures: BoxedFigure[] = []
  value.questions.forEach((item) => {
    const raw = rec(item); const ref = str(raw?.ref); const question = boxRegion(raw?.question)
    const options = boxRegion(raw?.options); const caseStem = boxRegion(raw?.case_stem); const inlineEvidence = boxRegion(raw?.inline_evidence)
    if (ref === undefined || question === undefined || question === null || options === undefined || caseStem === undefined || inlineEvidence === undefined) { return }
    questions.push({ ref, question, options, caseStem, inlineEvidence })
  })
  value.figures.forEach((item) => {
    const raw = rec(item); const p = page(raw?.page); const b = box(raw?.box_2d); const anchor = str(raw?.anchor)
    const refs = Array.isArray(raw?.linked_refs) ? raw.linked_refs.filter((x): x is string => typeof x === 'string') : []
    if (p === undefined || b === undefined || anchor === undefined || refs.length === 0) { return }
    figures.push({ page: p, linkedRefs: refs, box: b, anchor })
  })
  return { ok: true, value: { questions, figures } }
}

export function parseEvidenceMap(text: string): ParseResult<EvidenceMap> {
  const value = root(text); const type = str(value?.type); const markingStyle = str(value?.marking_style)
  if (value === undefined || markingStyle === undefined || !Array.isArray(value.evidence) ||
    !POLICY_TYPES.includes(type as EvidenceMap['type'])) return { ok: false, errors: ['evidence response is invalid'] }
  const errors: string[] = []; const evidence: KeyEvidence[] = []
  value.evidence.forEach((item, index) => {
    const raw = rec(item); const ref = str(raw?.ref); const state = str(raw?.state) as EvidenceState | undefined; const evidenceRegion = region(raw?.region)
    if (ref === undefined || state === undefined || !STATES.includes(state) || evidenceRegion === undefined) { errors.push('evidence[' + index + '] is invalid'); return }
    evidence.push({ ref, state, region: evidenceRegion })
  })
  return errors.length === 0
    ? { ok: true, value: { type: type as EvidenceMap['type'], markingStyle, evidence } }
    : { ok: false, errors }
}
