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

function numericLabel(label: string): number | undefined {
  const match = label.trim().match(/^(?:q(?:uestion)?\s*)?(\d+)[\).:\-]?$/i)
  return match === null ? undefined : Number(match[1])
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
  questions.sort((a, b) => a.ownerPage - b.ownerPage || a.ref.localeCompare(b.ref))
  const issues: PlanningIssue[] = []
  const bySection = new Map<string, ReconciledQuestion[]>()
  for (const question of questions) {
    const list = bySection.get(question.sectionKey) ?? []
    list.push(question)
    bySection.set(question.sectionKey, list)
  }
  for (const [section, rows] of bySection) {
    let previous: number | undefined
    for (const row of rows) {
      const current = numericLabel(row.printedLabel)
      if (current === undefined) continue
      if (previous !== undefined && current > previous + 1) {
        for (let missing = previous + 1; missing < current; missing += 1) {
          issues.push({ kind: 'missing_question', page: row.ownerPage, section, printedLabel: String(missing) })
        }
      }
      // A decrease is only a restart when the page-level heading corroborates
      // it. Otherwise record no invented gap and keep the rows in reading order.
      previous = current <= (previous ?? 0) && normalHint(row.sectionHint) !== section
        ? current
        : current
    }
  }
  for (const manifest of pagesByNumber.values()) {
    if (!manifest.containsQuestionStart) continue
    if (!questions.some((question) => question.ownerPage === manifest.page)) {
      issues.push({ kind: 'unreadable_page', page: manifest.page, section: manifest.sectionHint })
    }
  }
  return { questions, pages: [...pagesByNumber.values()].sort((a, b) => a.page - b.page), issues }
}
