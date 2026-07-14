import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, GlassInput, GlassPanel } from '../design/components'
import { reviewMessages } from '../copy/messages'
import { effectiveAnswer, type Resolutions, type ReviewRow } from './review-data'
import {
  isUnresolvedFlag,
  jumpIndex,
  parseSearch,
  type ReviewFilter,
} from './review-filter'
import { useVirtualWindow } from './review-virtual'

const rowHeight = 64
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
  initialScrollTop: number
  onScrollTopChange: (scrollTop: number) => void
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
  initialScrollTop,
  onScrollTopChange,
  focusRowId,
}: ReviewListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null)
  const [jumpHint, setJumpHint] = useState('')
  const parsedSearch = useMemo(() => parseSearch(search), [search])
  const unresolvedCount = reviewRows.filter((row) =>
    isUnresolvedFlag(row, resolutions),
  ).length
  const virtual = useVirtualWindow({
    scrollRef,
    count: filteredRows.length,
    rowHeight,
  })
  const { scrollToIndex } = virtual

  useLayoutEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = initialScrollTop
  }, [initialScrollTop])

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
    scrollToIndex(index, 'center')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(
      () => setHighlightedRowId((current) => current === rowId ? null : current),
      reduced ? 0 : 1800,
    )
    return () => window.clearTimeout(timer)
  }, [filter, filteredRows, parsedSearch, reviewRows, scrollToIndex])

  useEffect(() => {
    if (focusRowId === null) return
    const index = filteredRows.findIndex((row) => row.row.id === focusRowId)
    if (index === -1) return
    scrollToIndex(index, 'center')
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => rowRefs.current.get(focusRowId)?.focus())
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [filteredRows, focusRowId, scrollToIndex])

  return (
    <GlassPanel aria-label={reviewMessages.listPanelLabel} as="section" className="review-list" padding="default">
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
        <div
          className="review-list__viewport"
          onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
          ref={scrollRef}
        >
          <div className="review-list__spacer" role="list" style={{ height: virtual.totalHeight }}>
            {virtual.items.map((item) => {
              const reviewRow = filteredRows[item.index]
              if (reviewRow === undefined) return null
              const answer = effectiveAnswer(reviewRow, resolutions)
              const flagged = isUnresolvedFlag(reviewRow, resolutions)
              return (
                <button
                  aria-posinset={item.index + 1}
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
                  style={{ height: rowHeight, transform: `translateY(${item.offsetTop}px)` }}
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
        </div>
      )}
    </GlassPanel>
  )
}
