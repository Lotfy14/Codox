/**
 * Deterministic reconciliation of compact index windows. Printed labels are
 * evidence only; the source location is the stable identity used for retries,
 * figures, and deduplication.
 */
import type { IndexedQuestion, IndexWindow, PageManifest } from './index-pass'
import type { PlanningIssue } from '../state/types'

export interface ReconciledQuestion extends IndexedQuestion {
  ref: string
  ownerPage: number
  sourcePages: number[]
  sectionKey: string
}
export interface ReconciledIndex {
  questions: ReconciledQuestion[]
  pages: PageManifest[]
  issues: PlanningIssue[]
}

function normalHint(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
function sectionKey(question: IndexedQuestion): string {
  const hint = normalHint(question.sectionHint)
  return hint === '' ? 'page-' + question.ownerPage : hint
}

/** Convert one window's relative page coordinates into absolute coordinates. */
export function localizeIndexWindow(
  window: IndexWindow,
  contextPages: readonly number[],
  corePages: readonly number[],
  windowId: number,
): IndexWindow {
  const questions = window.questions.flatMap((question, ordinal) => {
    const ownerPage = contextPages[question.ownerPage - 1]
    const sourcePages = question.sourcePages
      .map((page) => contextPages[page - 1])
      .filter((page): page is number => page !== undefined)
    if (ownerPage === undefined || sourcePages.length === 0 || !corePages.includes(ownerPage)) return []
    return [{
      ...question,
      ref: 'w' + windowId + 'q' + ordinal,
      ownerPage,
      sourcePages: [...new Set(sourcePages)].sort((a, b) => a - b),
    }]
  })
  const pages = window.pages.flatMap((manifest) => {
    const p = contextPages[manifest.page - 1]
    return p === undefined ? [] : [{ ...manifest, page: p }]
  })
  return { questions, pages }
}

/**
 * Union shifted/retried windows without trusting model-issued references.
 * Same owner page + normalized anchor is intentionally conservative: a near
 * duplicate is retained rather than silently deleting a real question.
 *
 * Ordering is per-page reading order: within a page the questions keep the
 * order INDEX emitted them (top to bottom), NOT the order of their printed
 * numbers. A vision model lists a page's questions top-to-bottom far more
 * reliably than it OCRs a faint two-digit label, so a misread "19"→"1" can
 * no longer leapfrog a question to the top. The printed number is kept only
 * as the row's display label. Completeness — a genuinely skipped question —
 * is the read-only audit's job, not something inferred from the numbering.
 */
export function reconcileIndexWindows(windows: readonly IndexWindow[]): ReconciledIndex {
  const questions: ReconciledQuestion[] = []
  const pagesByNumber = new Map<number, PageManifest>()
  const seen = new Set<string>()
  for (const window of windows) {
    for (const page of window.pages) pagesByNumber.set(page.page, page)
    for (const question of window.questions) {
      const key = question.ownerPage + '\u0000' + normalHint(question.anchor)
      if (seen.has(key)) continue
      seen.add(key)
      questions.push({ ...question, sectionKey: sectionKey(question) })
    }
  }
  // Page, then emission order. Each page is owned by exactly one window's
  // core (localizeIndexWindow), so a page's questions all share a window id
  // and the ref ordinal is that window's top-to-bottom reading order. The
  // printed number never reorders and never infers a gap — real exams number
  // non-sequentially, so a genuine 18→20 jump must not invent a phantom 19.
  questions.sort((a, b) => a.ownerPage - b.ownerPage || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
  const issues: PlanningIssue[] = []
  for (const manifest of pagesByNumber.values()) {
    if (!manifest.containsQuestionStart) continue
    if (!questions.some((question) => question.ownerPage === manifest.page)) {
      issues.push({ kind: 'unreadable_page', page: manifest.page, section: manifest.sectionHint })
    }
  }
  return { questions, pages: [...pagesByNumber.values()].sort((a, b) => a.page - b.page), issues }
}
