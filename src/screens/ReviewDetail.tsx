import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Badge, Button, GlassPanel } from '../design/components'
import {
  aiExportMessages,
  aiReviewMessages,
  convertMessages,
  exportMessages,
  reviewMessages,
} from '../copy/messages'
import type { RunState, TopicItem } from '../state/types'
import type { ExportMode } from '../export/exporter'
import type { AiAnswer } from '../engine/solver'
import { solveRows } from '../engine/solver'
import type { MergedRow } from '../engine/types'
import type { TopicMatchesArtifact } from '../engine/topic-matcher'
import {
  answerSource,
  effectiveAnswer,
  saveResolution,
  type Resolutions,
  type ReviewRow,
} from './review-data'
import type { Edits } from './review-edits'
import { ReviewRowEditor } from './ReviewRowEditor'
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
  /** The engine's untouched merged rows — edit mode diffs against them. */
  pristineRows: readonly MergedRow[]
  edits: Edits
  topicMatches: TopicMatchesArtifact | undefined
  runTopics: TopicItem[] | undefined
  onNavigate: (rowId: string) => void
  onBack: () => void
  onExport: (mode: ExportMode, type: 'triviadox' | 'zip') => void
  exported: boolean
  filter: ReviewFilter
}

export function ReviewDetail({
  run,
  orderedRows,
  currentRowId,
  resolutions,
  aiAnswers,
  pristineRows,
  edits,
  topicMatches,
  runTopics,
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
  const [editing, setEditing] = useState(false)
  const confirmId = useId()
  const offline = useOffline()
  const source = useSourceUrls(run.id, reviewRow)
  const answer = reviewRow === undefined ? { index: null, source: 'none' as const } : answerSource(reviewRow, resolutions, aiAnswers)
  const seededAnswer = answer.index === null ? undefined : answer.index
  const [selected, setSelected] = useState<number | undefined>(seededAnswer)
  const [askingRowId, setAskingRowId] = useState<string | null>(null)
  const [askError, setAskError] = useState<string | null>(null)

  // The AI's stored answer for this question — display-only until the
  // tutor approves it (NEVER-GUESS: approval is the human decision).
  const ai = reviewRow === undefined ? undefined : aiAnswers?.[reviewRow.row.id]
  const aiIndex =
    reviewRow !== undefined &&
    ai !== undefined &&
    ai.index !== null &&
    Number.isInteger(ai.index) &&
    ai.index >= 0 &&
    ai.index < reviewRow.row.options.length
      ? ai.index
      : null
  const savedAnswer = reviewRow === undefined ? null : effectiveAnswer(reviewRow, resolutions)

  useEffect(() => {
    setSelected(seededAnswer)
    setWholePage(false)
  }, [currentRowId, seededAnswer])

  useEffect(() => {
    setEditing(false)
    setAskError(null)
  }, [currentRowId])

  const goTo = useCallback((index: number) => {
    const target = orderedRows[index]
    if (target !== undefined) onNavigate(target.row.id)
  }, [onNavigate, orderedRows])

  const tickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(tickTimer.current), [])

  const confirmIndex = useCallback((pick: number) => {
    if (reviewRow === undefined) return
    void saveResolution(run.id, reviewRow.row.id, pick)
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
  }, [currentIndex, filter, goTo, orderedRows, resolutions, reviewRow, run.id])

  const confirm = useCallback(() => {
    if (selected !== undefined) confirmIndex(selected)
  }, [confirmIndex, selected])

  /** One Gemini request for this question only; the answer is cached. */
  const askAi = useCallback(async () => {
    if (reviewRow === undefined || askingRowId !== null) return
    const rowId = reviewRow.row.id
    setAskingRowId(rowId)
    setAskError(null)
    try {
      const outcome = await solveRows(run.id, [rowId])
      if (!outcome.ok && outcome.failure.kind !== 'aborted') {
        setAskError(
          outcome.failure.kind === 'wrong-key'
            ? aiExportMessages.solveWrongKey
            : aiExportMessages.solveFailed,
        )
      }
    } catch {
      setAskError(aiExportMessages.solveFailed)
    } finally {
      setAskingRowId((current) => (current === rowId ? null : current))
    }
  }, [askingRowId, reviewRow, run.id])

  /** The explicit approval: saves the AI's pick as the tutor's answer. */
  const applyAiAnswer = useCallback(() => {
    if (aiIndex === null) return
    setSelected(aiIndex)
    confirmIndex(aiIndex)
  }, [aiIndex, confirmIndex])

  useEffect(() => {
    if (allResolved || reviewRow === undefined) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return
      if (editing) {
        // Edit mode owns the keyboard: only Escape (cancel) is global.
        if (event.key === 'Escape') {
          setEditing(false)
          event.preventDefault()
        }
        return
      }
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
      } else if (event.key === 'e') {
        setEditing(true)
        event.preventDefault()
      } else if (event.key === 'a') {
        // The natural AI action: approve a differing suggestion, else ask.
        if (askingRowId === null) {
          if (aiIndex !== null && aiIndex !== savedAnswer) applyAiAnswer()
          else void askAi()
        }
        event.preventDefault()
      } else if (event.key === 'Enter' && !isActivationTarget(event.target)) {
        confirm()
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [aiIndex, allResolved, askAi, askingRowId, confirm, confirmId, currentIndex, editing, goTo, reviewRow, savedAnswer, applyAiAnswer])

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
            <Button onPress={() => onExport('with-answers', 'triviadox')}>
              {exported ? 'Export to Triviadox again' : 'Export to Triviadox'}
            </Button>
            <Button onPress={() => onExport('with-answers', 'zip')} variant="secondary">
              Download ZIP
            </Button>
            <Button onPress={onBack}>{reviewMessages.backToList}</Button>
          </div>
        </GlassPanel>
      </section>
    )
  }

  const imageUrl = wholePage ? source.page : (source.crop ?? source.page)
  const displayQuestion = reviewRow.row.question.replace(/^\s*case\s*stem\s*:\s*/i, '')
  const rowEdit = edits[reviewRow.row.id]
  const figureCrops = source.figures.map((url, index) => (
    <figure className="review-paper review-paper--figure" key={url}>
      <figcaption className="review-paper__label">
        {reviewMessages.figureCaption(index + 1, source.figures.length)}
      </figcaption>
      <img alt={reviewMessages.figureAlt(reviewRow.questionNumber, index + 1)} src={url} />
    </figure>
  ))

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
          {figureCrops}
        </section>

        <section
          aria-label={`Question ${reviewRow.questionNumber}`}
          className={`review__question ${justResolved ? 'review__question--tick' : ''}`}
        >
          {editing ? (
            <ReviewRowEditor
              aiAnswer={aiAnswers?.[reviewRow.row.id]}
              baseline={{
                topic: topicMatches?.matches[reviewRow.row.id]?.topic ?? '',
                subtopic: topicMatches?.matches[reviewRow.row.id]?.subtopic ?? '',
                year: run.yearMode === 'type'
                  ? (run.typedYear ?? '')
                  : run.yearMode === 'ai'
                    ? (pristineRows.find((row) => row.id === reviewRow.row.id)?.year ?? '')
                    : '',
              }}
              edit={rowEdit}
              initialCorrect={effectiveAnswer(reviewRow, resolutions)}
              key={reviewRow.row.id}
              onClose={() => setEditing(false)}
              pristineRow={pristineRows.find((row) => row.id === reviewRow.row.id) ?? reviewRow.row}
              reviewRow={reviewRow}
              run={run}
              runTopics={runTopics}
              storedResolution={resolutions[reviewRow.row.id]}
            />
          ) : (
            <>
              <div className="review__question-header">
                <div className="review__nav-group">
                  <Button
                    isDisabled={currentIndex === 0}
                    onPress={() => goTo(currentIndex - 1)}
                    variant="quiet"
                    aria-label={reviewMessages.previous}
                    title={reviewMessages.previous}
                  >
                    <svg
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }}
                    >
                      <path d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>{reviewMessages.previous}</span>
                  </Button>
                  <Button
                    isDisabled={currentIndex === orderedRows.length - 1}
                    onPress={() => goTo(currentIndex + 1)}
                    variant="quiet"
                    aria-label={reviewMessages.next}
                    title={reviewMessages.next}
                  >
                    <span>{reviewMessages.next}</span>
                    <svg
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }}
                    >
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </Button>
                </div>
                <Button
                  onPress={() => setEditing(true)}
                  variant="quiet"
                  aria-label={reviewMessages.edit}
                  title={reviewMessages.edit}
                  className="review__edit-btn"
                >
                  <svg
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    style={{ display: 'inline-block', verticalAlign: 'middle' }}
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </Button>
              </div>
              <h3>
                {displayQuestion}
                {rowEdit !== undefined ? (
                  <Badge className="review__edited-badge" tone="primary">
                    {reviewMessages.editedBadge}
                  </Badge>
                ) : null}
              </h3>
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
              {figureCrops.length > 0 ? (
                <div className="review__mobile-figures">{figureCrops}</div>
              ) : null}
              <div aria-label={reviewMessages.pickAnswer} className="review__options" role="radiogroup">
                {reviewRow.row.options.map((option, index) => (
                  <button
                    aria-checked={selected === index}
                    className="review-option"
                    data-ai={aiIndex === index ? true : undefined}
                    key={`${reviewRow.row.id}-${index}`}
                    onClick={() => setSelected(index)}
                    role="radio"
                    type="button"
                  >
                    <span aria-hidden="true" className="review-option__letter">
                      {optionLetters[index] ?? index + 1}
                    </span>
                    <span>{option}</span>
                    {aiIndex === index ? (
                      <span className="review-option__tag">AI</span>
                    ) : null}
                    <kbd aria-hidden="true">{index + 1}</kbd>
                  </button>
                ))}
              </div>
              <div aria-label={aiReviewMessages.stripLabel} className="review-ai" role="group">
                {askingRowId === reviewRow.row.id ? (
                  <span className="ds-muted" role="status">{aiReviewMessages.asking}</span>
                ) : ai === undefined ? (
                  <Button isDisabled={offline} onPress={() => void askAi()} variant="quiet">
                    {aiReviewMessages.askOne}
                  </Button>
                ) : aiIndex === null ? (
                  <>
                    <span className="ds-muted">{aiReviewMessages.aiUnsure}</span>
                    <Button isDisabled={offline} onPress={() => void askAi()} variant="quiet">
                      {aiReviewMessages.askAgainOne}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="review-ai__pick">
                      {aiReviewMessages.suggestion(optionLetters[aiIndex] ?? String(aiIndex + 1))}
                      <span className="review-ai__confidence">
                        {' · '}
                        {aiReviewMessages.confidence[ai.confidence] ?? ai.confidence}
                      </span>
                    </span>
                    {aiIndex === savedAnswer ? (
                      <span className="ds-muted">{aiReviewMessages.aiAgrees}</span>
                    ) : (
                      <Button onPress={applyAiAnswer} variant="secondary">
                        {aiReviewMessages.useAi}
                      </Button>
                    )}
                    <Button isDisabled={offline} onPress={() => void askAi()} variant="quiet">
                      {aiReviewMessages.askAgainOne}
                    </Button>
                  </>
                )}
                {askError !== null ? (
                  <span className="ds-inline-note ds-inline-note--danger" role="alert">
                    {askError}
                  </span>
                ) : null}
              </div>
              <div className="review__actions">
                <Button id={confirmId} isDisabled={selected === undefined} onPress={confirm}>
                  {reviewMessages.confirm}
                </Button>
              </div>
            </>
          )}
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
