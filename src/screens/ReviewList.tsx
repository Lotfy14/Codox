import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge, Button, GlassInput } from '../design/components'
import { aiReviewMessages, reviewMessages } from '../copy/messages'
import type { AiAnswer } from '../engine/solver'
import type { TopicItem } from '../state/types'
import { effectiveAnswer, type Resolutions, type ReviewRow } from './review-data'
import { saveRowEditsPatch, type MetaPatch } from './review-edits'
import { setRowsDeleted } from './review-mutations'
import {
  isUnresolvedFlag,
  jumpIndex,
  parseSearch,
  type ReviewFilter,
} from './review-filter'

const answerLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface ReviewListProps {
  runId: string
  reviewRows: readonly ReviewRow[]
  filteredRows: readonly ReviewRow[]
  resolutions: Resolutions
  aiAnswers: Record<string, AiAnswer> | undefined
  runTopics: TopicItem[] | undefined
  filter: ReviewFilter
  search: string
  onFilterChange: (filter: ReviewFilter) => void
  onSearchChange: (search: string) => void
  onOpenRow: (rowId: string) => void
  onOpenAiDialog: () => void
  onAddRow: () => void
  focusRowId: string | null
}

/** The AI's valid pick for a row, or null (unsure / never asked). */
function aiPick(
  reviewRow: ReviewRow,
  aiAnswers: Record<string, AiAnswer> | undefined,
): number | null {
  const ai = aiAnswers?.[reviewRow.row.id]
  if (ai === undefined || ai.index === null) return null
  return Number.isInteger(ai.index) &&
    ai.index >= 0 &&
    ai.index < reviewRow.row.options.length
    ? ai.index
    : null
}

export function ReviewList({
  runId,
  reviewRows,
  filteredRows,
  resolutions,
  aiAnswers,
  runTopics,
  filter,
  search,
  onFilterChange,
  onSearchChange,
  onOpenRow,
  onOpenAiDialog,
  onAddRow,
  focusRowId,
}: ReviewListProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null)
  const [jumpHint, setJumpHint] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [bulkTopic, setBulkTopic] = useState('')
  const [bulkSubtopic, setBulkSubtopic] = useState('')
  const [bulkYear, setBulkYear] = useState('')
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  // The rowIds of the last delete, so it can be undone in one tap.
  const [deletedUndo, setDeletedUndo] = useState<readonly string[]>([])
  const topicListId = useId()
  const subtopicListId = useId()
  const parsedSearch = useMemo(() => parseSearch(search), [search])
  const unresolvedCount = reviewRows.filter((row) =>
    isUnresolvedFlag(row, resolutions),
  ).length

  // Prune selection to rows that still exist (edits can drop/rename ids) and
  // reset the bulk panel whenever the run changes underneath it.
  const validIds = useMemo(
    () => new Set(reviewRows.map((row) => row.row.id)),
    [reviewRows],
  )
  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [validIds])
  useEffect(() => {
    setSelected(new Set())
    setBulkTopic('')
    setBulkSubtopic('')
    setBulkYear('')
    setBulkStatus('')
    setDeletedUndo([])
  }, [runId])

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

  const topics = runTopics ?? []
  const subtopics =
    topics.find((item) => item.topic === bulkTopic.trim())?.subtopics ??
    topics.flatMap((item) => item.subtopics)

  const toggleRow = (rowId: string) => {
    setBulkStatus('')
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const selectAllFiltered = () => {
    setBulkStatus('')
    setSelected(new Set(filteredRows.map((row) => row.row.id)))
  }

  const clearSelection = () => {
    setBulkStatus('')
    setSelected(new Set())
  }

  const deleteSelected = () => {
    if (selected.size === 0) return
    const ids = [...selected]
    setBulkStatus('')
    void setRowsDeleted(runId, ids, true).then(() => {
      setDeletedUndo(ids)
      setSelected(new Set())
    })
  }

  const undoDelete = () => {
    if (deletedUndo.length === 0) return
    const ids = deletedUndo
    void setRowsDeleted(runId, ids, false).then(() => setDeletedUndo([]))
  }

  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((row) => selected.has(row.row.id))

  const buildPatch = (fields: MetaPatch): void => {
    if (selected.size === 0) return
    setBulkBusy(true)
    const patches: Record<string, MetaPatch> = {}
    for (const id of selected) patches[id] = fields
    void saveRowEditsPatch(runId, patches)
      .then(() => {
        const count = selected.size
        const cleared =
          fields.topic === '' && fields.subtopic === '' && fields.year === ''
        setBulkStatus(
          cleared
            ? reviewMessages.bulkCleared(count)
            : reviewMessages.bulkApplied(count),
        )
        setSelected(new Set())
        setBulkTopic('')
        setBulkSubtopic('')
        setBulkYear('')
      })
      .finally(() => setBulkBusy(false))
  }

  const applyBulk = () => {
    const fields: MetaPatch = {}
    if (bulkTopic.trim() !== '') fields.topic = bulkTopic
    if (bulkSubtopic.trim() !== '') fields.subtopic = bulkSubtopic
    if (bulkYear.trim() !== '') fields.year = bulkYear
    if (Object.keys(fields).length === 0) {
      setBulkStatus(reviewMessages.bulkNothingToApply)
      return
    }
    buildPatch(fields)
  }

  const clearBulkFields = () => {
    buildPatch({ topic: '', subtopic: '', year: '' })
  }

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
          <Button onPress={onOpenAiDialog} variant="secondary">
            {aiReviewMessages.openDialog}
          </Button>
          <Button onPress={onAddRow} title={reviewMessages.addRowHint} variant="secondary">
            {reviewMessages.addRow}
          </Button>
        </div>
        <div className="review-list__select-tools">
          <Button
            isDisabled={filteredRows.length === 0 || allFilteredSelected}
            onPress={selectAllFiltered}
            variant="quiet"
          >
            {reviewMessages.bulkSelectAll(filteredRows.length)}
          </Button>
          {selected.size > 0 ? (
            <>
              <span className="ds-muted review-list__select-count" role="status">
                {reviewMessages.bulkSelectedCount(selected.size)}
              </span>
              <Button onPress={clearSelection} variant="quiet">
                {reviewMessages.bulkClearSelection}
              </Button>
              <Button onPress={deleteSelected} variant="danger">
                {reviewMessages.deleteSelected(selected.size)}
              </Button>
            </>
          ) : null}
        </div>
        <p aria-live="polite" className="ds-muted review-list__hint">{jumpHint}</p>
      </header>

      {selected.size > 0 ? (
        <div
          aria-label={reviewMessages.bulkBarLabel}
          className="review-list__bulk-bar"
          role="group"
        >
          <div className="review-list__bulk-fields">
            <GlassInput
              inputProps={{ list: topicListId }}
              label={reviewMessages.bulkTopicLabel}
              onChange={setBulkTopic}
              value={bulkTopic}
            />
            <GlassInput
              inputProps={{ list: subtopicListId }}
              label={reviewMessages.bulkSubtopicLabel}
              onChange={setBulkSubtopic}
              value={bulkSubtopic}
            />
            <GlassInput
              label={reviewMessages.bulkYearLabel}
              onChange={setBulkYear}
              value={bulkYear}
            />
            <datalist id={topicListId}>
              {topics.map((item) => <option key={item.topic} value={item.topic} />)}
            </datalist>
            <datalist id={subtopicListId}>
              {[...new Set(subtopics)].map((value) => <option key={value} value={value} />)}
            </datalist>
          </div>
          <div className="review-list__bulk-actions">
            <Button isDisabled={bulkBusy} onPress={applyBulk}>
              {reviewMessages.bulkApply}
            </Button>
            <Button isDisabled={bulkBusy} onPress={clearBulkFields} variant="quiet">
              {reviewMessages.bulkClearFields}
            </Button>
          </div>
          <p className="ds-muted review-list__bulk-hint">{reviewMessages.bulkApplyHint}</p>
        </div>
      ) : null}

      {bulkStatus !== '' ? (
        <p
          aria-live="polite"
          className="ds-inline-note ds-inline-note--info review-list__bulk-status"
          role="status"
        >
          {bulkStatus}
        </p>
      ) : null}

      {deletedUndo.length > 0 ? (
        <p
          aria-live="polite"
          className="ds-inline-note ds-inline-note--info review-list__bulk-status"
          role="status"
        >
          {reviewMessages.rowsDeleted(deletedUndo.length)}{' '}
          <Button onPress={undoDelete} variant="quiet">
            {reviewMessages.undoDelete}
          </Button>
        </p>
      ) : null}

      {filteredRows.length === 0 ? (
        <p className="ds-muted review-list__empty">{reviewMessages.searchNoMatches}</p>
      ) : (
        <div className="review-list__rows" role="list">
          {filteredRows.map((reviewRow, index) => {
            const answer = effectiveAnswer(reviewRow, resolutions)
            const flagged = isUnresolvedFlag(reviewRow, resolutions)
            const ai = aiPick(reviewRow, aiAnswers)
            const rowId = reviewRow.row.id
            const isSelected = selected.has(rowId)
            return (
              <div
                aria-posinset={index + 1}
                aria-setsize={filteredRows.length}
                className={[
                  'review-list-row-wrap',
                  isSelected ? 'review-list-row-wrap--selected' : '',
                ].filter(Boolean).join(' ')}
                key={rowId}
                role="listitem"
              >
                <input
                  aria-label={reviewMessages.bulkSelectRow(reviewRow.questionNumber)}
                  checked={isSelected}
                  className="review-list-row__check"
                  onChange={() => toggleRow(rowId)}
                  type="checkbox"
                />
                <button
                  className={[
                    'review-list-row',
                    flagged ? 'review-list-row--flagged' : '',
                    highlightedRowId === rowId ? 'review-list-row--highlight' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onOpenRow(rowId)}
                  ref={(element) => {
                    if (element === null) rowRefs.current.delete(rowId)
                    else rowRefs.current.set(rowId, element)
                  }}
                  type="button"
                >
                  <span className="review-list-row__num">{reviewRow.questionNumber}</span>
                  <span className="review-list-row__text">{reviewRow.row.question}</span>
                  {flagged ? <Badge tone="warning">{reviewMessages.needsReviewFilter(1)}</Badge> : null}
                  {ai !== null && ai !== answer ? (
                    <Badge tone={answer === null ? 'primary' : 'warning'}>
                      {answer === null
                        ? aiReviewMessages.chipSuggests(answerLetters[ai] ?? String(ai + 1))
                        : aiReviewMessages.chipDiffers(answerLetters[ai] ?? String(ai + 1))}
                    </Badge>
                  ) : null}
                  <span className="review-list-row__answer">
                    {answer === null ? reviewMessages.answerBlank : (answerLetters[answer] ?? answer + 1)}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
