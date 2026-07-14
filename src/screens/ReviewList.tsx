import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, GlassInput } from '../design/components'
import { reviewMessages } from '../copy/messages'
import { effectiveAnswer, type Resolutions, type ReviewRow } from './review-data'
import {
  isUnresolvedFlag,
  jumpIndex,
  parseSearch,
  type ReviewFilter,
} from './review-filter'

const answerLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface ReviewListProps {
  reviewRows: readonly ReviewRow[]
  filteredRows: readonly ReviewRow[]
  resolutions: Resolutions
  filter: ReviewFilter
  search: string
  onFilterChange: (filter: ReviewFilter) => void
  onSearchChange: (search: string) => void
  onOpenRow: (rowId: string) => void
  focusRowId: string | null
}

export function ReviewList({
  reviewRows,
  filteredRows,
  resolutions,
  filter,
  search,
  onFilterChange,
  onSearchChange,
  onOpenRow,
  focusRowId,
}: ReviewListProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null)
  const [jumpHint, setJumpHint] = useState('')
  const parsedSearch = useMemo(() => parseSearch(search), [search])
  const unresolvedCount = reviewRows.filter((row) =>
    isUnresolvedFlag(row, resolutions),
  ).length
  useEffect(() => {
    if (parsedSearch.kind !== 'jump') {
      setJumpHint('')
      setHighlightedRowId(null)
      return
    }
    const index = jumpIndex(filteredRows, parsedSearch.questionNumber)
    if (index === -1) {
      const exists = jumpIndex(reviewRows, parsedSearch.questionNumber) !== -1
      setJumpHint(exists && filter === 'needs-review'
        ? reviewMessages.jumpHiddenByFilter
        : '')
      setHighlightedRowId(null)
      return
    }
    const rowId = filteredRows[index].row.id
    setJumpHint('')
    setHighlightedRowId(rowId)
    rowRefs.current.get(rowId)?.scrollIntoView({ block: 'center' })
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(
      () => setHighlightedRowId((current) => current === rowId ? null : current),
      reduced ? 0 : 1800,
    )
    return () => window.clearTimeout(timer)
  }, [filter, filteredRows, parsedSearch, reviewRows])

  useEffect(() => {
    if (focusRowId === null) return
    const frame = window.requestAnimationFrame(() => {
      const row = rowRefs.current.get(focusRowId)
      row?.focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [filteredRows, focusRowId])

  return (
    <section aria-label={reviewMessages.listPanelLabel} className="review-list">
      <header className="review-list__header">
        <p className="review-list__count">{reviewMessages.questionCount(reviewRows.length)}</p>
        <div className="review-list__tools">
          <GlassInput
            className="review-list__search"
            label={reviewMessages.searchLabel}
            onChange={onSearchChange}
            placeholder={reviewMessages.searchPlaceholder}
            type="search"
            value={search}
          />
          <Button
            aria-pressed={filter === 'needs-review'}
            className="review-list__filter"
            onPress={() => onFilterChange(filter === 'all' ? 'needs-review' : 'all')}
            variant="secondary"
          >
            {filter === 'needs-review'
              ? reviewMessages.showAllFilter
              : reviewMessages.needsReviewFilter(unresolvedCount)}
          </Button>
        </div>
        <p aria-live="polite" className="ds-muted review-list__hint">{jumpHint}</p>
      </header>

      {filteredRows.length === 0 ? (
        <p className="ds-muted review-list__empty">{reviewMessages.searchNoMatches}</p>
      ) : (
        <div className="review-list__rows" role="list">
          {filteredRows.map((reviewRow, index) => {
            const answer = effectiveAnswer(reviewRow, resolutions)
            const flagged = isUnresolvedFlag(reviewRow, resolutions)
            return (
              <button
                  aria-posinset={index + 1}
                  aria-setsize={filteredRows.length}
                  className={[
                    'review-list-row',
                    flagged ? 'review-list-row--flagged' : '',
                    highlightedRowId === reviewRow.row.id ? 'review-list-row--highlight' : '',
                  ].filter(Boolean).join(' ')}
                  key={reviewRow.row.id}
                  onClick={() => onOpenRow(reviewRow.row.id)}
                  ref={(element) => {
                    if (element === null) rowRefs.current.delete(reviewRow.row.id)
                    else rowRefs.current.set(reviewRow.row.id, element)
                  }}
                  role="listitem"
                  type="button"
                >
                  <span className="review-list-row__num">{reviewRow.questionNumber}</span>
                  <span className="review-list-row__text">{reviewRow.row.question}</span>
                  {flagged ? <Badge tone="warning">{reviewMessages.needsReviewFilter(1)}</Badge> : null}
                  <span className="review-list-row__answer">
                    {answer === null ? reviewMessages.answerBlank : (answerLetters[answer] ?? answer + 1)}
                  </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
