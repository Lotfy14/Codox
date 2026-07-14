import type { Resolutions, ReviewRow } from './review-data'

export type ReviewFilter = 'all' | 'needs-review'

export type ParsedSearch =
  | { kind: 'none' }
  | { kind: 'jump'; questionNumber: number }
  | { kind: 'text'; text: string }

export function parseSearch(query: string): ParsedSearch {
  const trimmed = query.trim()
  if (trimmed === '') return { kind: 'none' }
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'jump', questionNumber: Number.parseInt(trimmed, 10) }
  }
  return { kind: 'text', text: trimmed.toLocaleLowerCase() }
}

export function isUnresolvedFlag(
  row: ReviewRow,
  resolutions: Resolutions,
): boolean {
  const pick = resolutions[row.row.id]
  const hasValidResolution = pick !== undefined &&
    Number.isInteger(pick) &&
    pick >= 0 &&
    pick < row.row.options.length
  return row.category !== null && !hasValidResolution
}

export function filterReviewRows(
  reviewRows: readonly ReviewRow[],
  filter: ReviewFilter,
  search: ParsedSearch,
  resolutions: Resolutions,
): ReviewRow[] {
  const filtered = filter === 'needs-review'
    ? reviewRows.filter((row) => isUnresolvedFlag(row, resolutions))
    : [...reviewRows]
  if (search.kind !== 'text') return filtered
  return filtered.filter((row) =>
    [row.row.question, ...row.row.options]
      .some((text) => text.toLocaleLowerCase().includes(search.text)),
  )
}

export function jumpIndex(
  rows: readonly ReviewRow[],
  questionNumber: number,
): number {
  return rows.findIndex((row) => row.questionNumber === questionNumber)
}
