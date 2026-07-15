import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, GlassPanel } from '../design/components'
import { convertMessages, exportMessages, reviewMessages } from '../copy/messages'
import type { RunState } from '../state/types'
import type { AiAnswer } from '../engine/solver'
import {
  answerSource,
  saveResolution,
  type Resolutions,
  type ReviewRow,
} from './review-data'
import { isUnresolvedFlag, type ReviewFilter } from './review-filter'
import {
  isActivationTarget,
  isTypingTarget,
  useOffline,
  useSourceUrls,
} from './useSourceUrls'

const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const

export interface ReviewDetailProps {
  run: RunState
  orderedRows: readonly ReviewRow[]
  currentRowId: string
  resolutions: Resolutions
  aiAnswers: Record<string, AiAnswer> | undefined
  onNavigate: (rowId: string) => void
  onBack: () => void
  onExport: () => void
  exported: boolean
  filter: ReviewFilter
}

export function ReviewDetail({
  run,
  orderedRows,
  currentRowId,
  resolutions,
  aiAnswers,
  onNavigate,
  onBack,
  onExport,
  exported,
  filter,
}: ReviewDetailProps) {
  const currentIndex = Math.max(
    0,
    orderedRows.findIndex((row) => row.row.id === currentRowId),
  )
  const reviewRow = orderedRows[currentIndex]
  const unresolved = orderedRows.filter((row) => isUnresolvedFlag(row, resolutions))
  const allResolved = filter === 'needs-review' && unresolved.length === 0
  const flagged = orderedRows.filter((row) => row.category !== null)
  const resolvedCount = flagged.length - unresolved.length
  const [wholePage, setWholePage] = useState(false)
  const [justResolved, setJustResolved] = useState(false)
  const confirmId = useId()
  const offline = useOffline()
  const source = useSourceUrls(run.id, reviewRow)
  const answer = reviewRow === undefined ? { index: null, source: 'none' as const } : answerSource(reviewRow, resolutions, aiAnswers)
  const seededAnswer = answer.index === null ? undefined : answer.index
  const [selected, setSelected] = useState<number | undefined>(seededAnswer)

  useEffect(() => {
    setSelected(seededAnswer)
    setWholePage(false)
  }, [currentRowId, seededAnswer])

  const goTo = useCallback((index: number) => {
    const target = orderedRows[index]
    if (target !== undefined) onNavigate(target.row.id)
  }, [onNavigate, orderedRows])

  const tickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(tickTimer.current), [])

  const confirm = useCallback(() => {
    if (reviewRow === undefined || selected === undefined) return
    void saveResolution(run.id, reviewRow.row.id, selected)
    setJustResolved(true)
    window.clearTimeout(tickTimer.current)
    tickTimer.current = window.setTimeout(() => setJustResolved(false), 360)

    if (filter === 'all') {
      if (currentIndex < orderedRows.length - 1) goTo(currentIndex + 1)
      return
    }
    const next = orderedRows.findIndex((row, index) =>
      index > currentIndex && isUnresolvedFlag(row, resolutions),
    )
    if (next !== -1) {
      goTo(next)
      return
    }
    const wrapped = orderedRows.findIndex((row, index) =>
      index < currentIndex && isUnresolvedFlag(row, resolutions),
    )
    if (wrapped !== -1) goTo(wrapped)
  }, [currentIndex, filter, goTo, orderedRows, resolutions, reviewRow, run.id, selected])

  useEffect(() => {
    if (allResolved || reviewRow === undefined) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return
      const optionIndex = Number.parseInt(event.key, 10) - 1
      if (
        Number.isInteger(optionIndex) &&
        optionIndex >= 0 &&
        optionIndex < reviewRow.row.options.length
      ) {
        setSelected(optionIndex)
        window.setTimeout(() => document.getElementById(confirmId)?.focus(), 0)
        event.preventDefault()
      } else if (event.key === 'ArrowRight' || event.key === 'n') {
        goTo(currentIndex + 1)
        event.preventDefault()
      } else if (event.key === 'ArrowLeft' || event.key === 'p') {
        goTo(currentIndex - 1)
        event.preventDefault()
      } else if (event.key === 'w') {
        setWholePage((current) => !current)
        event.preventDefault()
      } else if (event.key === 'Enter' && !isActivationTarget(event.target)) {
        confirm()
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [allResolved, confirm, confirmId, currentIndex, goTo, reviewRow])

  const imageUrl = wholePage ? source.page : (source.crop ?? source.page)
  const displayQuestion = reviewRow.row.question.replace(/^\s*case\s*stem\s*:\s*/i, '')
  if (allResolved || reviewRow === undefined) {
    return (
      <section aria-labelledby="review-done-heading" className="review-done">
        <GlassPanel as="div" padding="spacious">
          <p aria-hidden="true" className="review-done-mark">✓</p>
          <h2 id="review-done-heading">{reviewMessages.allResolved}</h2>
          {exported ? (
            <p className="ds-inline-note ds-inline-note--working" role="status">
              {exportMessages.exportDone}
            </p>
          ) : null}
          <div className="review-done-actions">
            <Button onPress={onExport}>
              {exported ? convertMessages.exportAgain : convertMessages.exportBundle}
            </Button>
            <Button onPress={onBack}>{reviewMessages.backToList}</Button>
          </div>
        </GlassPanel>
      </section>
    )
  }

  return (
    <section aria-labelledby="review-heading" className="review">
      <h2 className="ds-visually-hidden" id="review-heading">
        {reviewMessages.reviewHeading(run.fileName)}
      </h2>

      <div className="review__split">
        <section
          aria-label={reviewRow.pageIndex === null
            ? reviewMessages.sourceUnavailableLabel
            : `Source, page ${reviewRow.pageIndex + 1}`}
          className="review__source"
        >
          {imageUrl === null ? (
            <p className="ds-muted">{reviewMessages.sourceUnavailable}</p>
          ) : (
            <figure className="review-paper">
              <figcaption className="review-paper__label">
                {reviewMessages.pageCaption(
                  (reviewRow.pageIndex ?? 0) + 1,
                  run.fileName,
                  wholePage,
                )}
              </figcaption>
              <img alt={reviewMessages.sourceAlt(reviewRow.questionNumber)} src={imageUrl} />
            </figure>
          )}
          {source.crop !== null && source.page !== null ? (
            <Button onPress={() => setWholePage((current) => !current)} variant="secondary">
              {wholePage ? reviewMessages.questionArea : reviewMessages.wholePage}
            </Button>
          ) : null}
        </section>

        <section
          aria-label={`Question ${reviewRow.questionNumber}`}
          className={`review__question ${justResolved ? 'review__question--tick' : ''}`}
        >
          <h3>{displayQuestion}</h3>
          {imageUrl !== null ? (
            <button
              aria-label={wholePage ? reviewMessages.questionArea : reviewMessages.wholePage}
              aria-pressed={wholePage}
              className="review__mobile-source"
              data-whole-page={wholePage || undefined}
              disabled={source.crop === null || source.page === null}
              onClick={() => setWholePage((current) => !current)}
              type="button"
            >
              <figure className="review-paper">
                <figcaption className="review-paper__label">
                  {reviewMessages.pageCaption(
                    (reviewRow.pageIndex ?? 0) + 1,
                    run.fileName,
                    wholePage,
                  )}
                </figcaption>
                <img alt={reviewMessages.sourceAlt(reviewRow.questionNumber)} src={imageUrl} />
              </figure>
            </button>
          ) : null}
          <div aria-label={reviewMessages.pickAnswer} className="review__options" role="radiogroup">
            {reviewRow.row.options.map((option, index) => (
              <button
                aria-checked={selected === index}
                className="review-option"
                data-ai={answer.source === 'ai' && index === answer.index ? true : undefined}
                key={`${reviewRow.row.id}-${index}`}
                onClick={() => setSelected(index)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className="review-option__letter">
                  {optionLetters[index] ?? index + 1}
                </span>
                <span>{option}</span>
                {answer.source === 'ai' && index === answer.index ? (
                  <span className="review-option__tag">AI</span>
                ) : null}
                <kbd aria-hidden="true">{index + 1}</kbd>
              </button>
            ))}
          </div>
          <div className="review__actions">
            <Button id={confirmId} isDisabled={selected === undefined} onPress={confirm}>
              {reviewMessages.confirm}
            </Button>
            <Button isDisabled={currentIndex === 0} onPress={() => goTo(currentIndex - 1)} variant="quiet">
              {reviewMessages.previous}
            </Button>
            <Button isDisabled={currentIndex === orderedRows.length - 1} onPress={() => goTo(currentIndex + 1)} variant="quiet">
              {reviewMessages.next}
            </Button>
          </div>
        </section>
      </div>

      <footer className="review__footer">
        <div className="review__meta">
          <span>{reviewMessages.questionPosition(currentIndex + 1, orderedRows.length)}</span>
          <span>{reviewMessages.pagePosition(reviewRow.questionNumber, reviewRow.pageIndex)}</span>
          {flagged.length > 0 ? (
            <span>{reviewMessages.flagsResolved(resolvedCount, flagged.length)}</span>
          ) : null}
        </div>
        <Button onPress={onBack}>{reviewMessages.backToList}</Button>
        {offline ? (
          <p className="ds-inline-note ds-inline-note--info" role="status">
            {reviewMessages.offlineIsFine}
          </p>
        ) : null}
      </footer>
    </section>
  )
}
