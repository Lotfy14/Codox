import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge, Button, GlassPanel } from '../design/components'
import {
  aiReviewMessages,
  aiSolveMessages,
  exportMessages,
  reviewMessages,
} from '../copy/messages'
import type { RunState, TopicItem } from '../state/types'
import { useCustomizationSettings } from '../state/customization-settings'
import { ExportButton } from './ExportButton'
import type { AiAnswer } from '../engine/solver'
import { solveRows } from '../engine/solver'
import type { MergedRow } from '../engine/types'
import type { TopicMatchesArtifact } from '../engine/topic-matcher'
import {
  answerSource,
  clearResolution,
  effectiveAnswer,
  saveResolution,
  type Resolutions,
  type ReviewRow,
} from './review-data'
import {
  planEditSave,
  saveRowEdit,
  updateAiAnswerIndex,
  type Edits,
} from './review-edits'
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
  const exportTarget = useCustomizationSettings()?.exportTarget ?? 'triviadox'
  const source = useSourceUrls(run.id, reviewRow)
  const answer = reviewRow === undefined ? { index: null, source: 'none' as const } : answerSource(reviewRow, resolutions, aiAnswers)
  const seededAnswer = answer.index === null ? undefined : answer.index
  const [selected, setSelected] = useState<number | undefined>(seededAnswer)
  const [askingRowId, setAskingRowId] = useState<string | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const [editQuestion, setEditQuestion] = useState('')
  const [editOptions, setEditOptions] = useState<{ text: string; originalIndex: number | null }[]>([])
  const [editCorrectChoice, setEditCorrectChoice] = useState<number | null>(null)
  const [editTopic, setEditTopic] = useState('')
  const [editSubtopic, setEditSubtopic] = useState('')
  const [editYear, setEditYear] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const topics = runTopics ?? []
  const subtopics =
    topics.find((item) => item.topic === editTopic.trim())?.subtopics ??
    topics.flatMap((item) => item.subtopics)
  const topicListId = useId()
  const subtopicListId = useId()

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
            ? aiSolveMessages.solveWrongKey
            : aiSolveMessages.solveFailed,
        )
      }
    } catch {
      setAskError(aiSolveMessages.solveFailed)
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

  const rowEdit = reviewRow === undefined ? undefined : edits[reviewRow.row.id]

  const baseline = useMemo(() => {
    if (!reviewRow) return { topic: '', subtopic: '', year: '' }
    const pristineRow = pristineRows.find((row) => row.id === reviewRow.row.id)
    return {
      topic: topicMatches?.matches[reviewRow.row.id]?.topic ?? '',
      subtopic: topicMatches?.matches[reviewRow.row.id]?.subtopic ?? '',
      year: run.yearMode === 'type'
        ? (run.typedYear ?? '')
        : run.yearMode === 'ai'
          ? (pristineRow?.year ?? '')
          : '',
    }
  }, [reviewRow, pristineRows, topicMatches, run])

  useEffect(() => {
    if (editing && reviewRow) {
      setEditQuestion(reviewRow.row.question)
      setEditOptions(reviewRow.row.options.map((text, index) => ({ text, originalIndex: index })))
      setEditCorrectChoice(effectiveAnswer(reviewRow, resolutions))
      setEditTopic(rowEdit?.topic ?? baseline.topic)
      setEditSubtopic(rowEdit?.subtopic ?? baseline.subtopic)
      setEditYear(rowEdit?.year ?? baseline.year)
    }
  }, [editing, reviewRow, rowEdit, baseline, resolutions])

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
            <ExportButton onPress={onExport} target={exportTarget} />
            <Button onPress={onBack}>{reviewMessages.backToList}</Button>
          </div>
        </GlassPanel>
      </section>
    )
  }

  const imageUrl = wholePage ? source.page : (source.crop ?? source.page)
  const displayQuestion = reviewRow.row.question.replace(/^\s*case\s*stem\s*:\s*/i, '')

  const validation =
    editQuestion.trim() === ''
      ? reviewMessages.editValidationEmptyQuestion
      : editOptions.length < 2
        ? reviewMessages.editValidationTooFewOptions
        : editOptions.some((option) => option.text.trim() === '')
          ? reviewMessages.editValidationEmptyOption
          : null

  const save = async () => {
    if (validation !== null || editSaving) return
    setEditSaving(true)
    try {
      const pristineRow = pristineRows.find((row) => row.id === reviewRow.row.id) ?? reviewRow.row
      const plan = planEditSave(
        pristineRow,
        reviewRow.row,
        {
          question: editQuestion,
          options: editOptions,
          correctChoice: editCorrectChoice,
          topic: editTopic,
          subtopic: editSubtopic,
          year: editYear,
          imageUrls: [...reviewRow.row.image_urls],
        },
        baseline,
        resolutions[reviewRow.row.id],
        aiAnswers?.[reviewRow.row.id],
      )
      await saveRowEdit(run.id, reviewRow.row.id, plan.edit)
      if (plan.resolution.kind === 'set') {
        await saveResolution(run.id, reviewRow.row.id, plan.resolution.index)
      } else if (plan.resolution.kind === 'clear') {
        await clearResolution(run.id, reviewRow.row.id)
      }
      if (plan.aiIndex !== undefined) {
        await updateAiAnswerIndex(run.id, reviewRow.row.id, plan.aiIndex)
      }
      setEditing(false)
    } finally {
      setEditSaving(false)
    }
  }

  const revert = async () => {
    if (editSaving) return
    setEditSaving(true)
    try {
      await saveRowEdit(run.id, reviewRow.row.id, null)
      setEditing(false)
    } finally {
      setEditSaving(false)
    }
  }


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
          <div className="review__question-header">
            <div className="review__nav-group">
              <Button
                isDisabled={currentIndex === 0 || editing}
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
                isDisabled={currentIndex === orderedRows.length - 1 || editing}
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
              onPress={() => setEditing((prev) => !prev)}
              variant={editing ? 'secondary' : 'quiet'}
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

          {editing ? (
            <textarea
              className="glass-input ds-glass-input__control review__question-textarea"
              value={editQuestion}
              onChange={(e) => setEditQuestion(e.target.value)}
              rows={Math.min(5, Math.max(2, editQuestion.split('\n').length))}
              style={{
                width: '100%',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-outline)',
                color: 'var(--color-text-strong)',
                fontFamily: 'var(--font-family-body)',
                fontSize: 'var(--font-size-md)',
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-input)',
                resize: 'vertical',
                marginBottom: 'var(--space-3)',
              }}
            />
          ) : (
            <h3>
              {displayQuestion}
              {rowEdit !== undefined ? (
                <Badge className="review__edited-badge" tone="primary">
                  {reviewMessages.editedBadge}
                </Badge>
              ) : null}
            </h3>
          )}

          {!editing && imageUrl !== null ? (
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
          {!editing && figureCrops.length > 0 ? (
            <div className="review__mobile-figures">{figureCrops}</div>
          ) : null}

          {editing ? (
            <div className="review__options">
              {editOptions.map((option, index) => {
                const letter = optionLetters[index] ?? String(index + 1)
                const isCorrect = editCorrectChoice === index
                return (
                  <div
                    className="review-option"
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-3)',
                    }}
                  >
                    <input
                      type="radio"
                      name="edit-correct-choice"
                      checked={isCorrect}
                      onChange={() => setEditCorrectChoice(index)}
                      style={{ cursor: 'pointer', margin: 0 }}
                      aria-label={reviewMessages.editOptionCorrect(letter)}
                    />
                    <span
                      aria-hidden="true"
                      className="review-option__letter"
                      style={{
                        borderColor: isCorrect ? 'var(--color-primary)' : 'var(--color-control-border)',
                        background: isCorrect ? 'var(--color-primary)' : 'transparent',
                        color: isCorrect ? 'var(--color-text-on-primary)' : 'inherit',
                      }}
                    >
                      {letter}
                    </span>
                    <input
                      type="text"
                      className="glass-input ds-glass-input__control"
                      value={option.text}
                      onChange={(e) => {
                        const text = e.target.value
                        setEditOptions((current) =>
                          current.map((opt, i) => (i === index ? { ...opt, text } : opt)),
                        )
                      }}
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-text-strong)',
                        fontSize: 'var(--font-size-md)',
                        outline: 'none',
                        padding: 0,
                      }}
                      aria-label={reviewMessages.editOptionLabel(letter)}
                    />
                    {editOptions.length > 2 && (
                      <Button
                        aria-label={reviewMessages.editRemoveOption(letter)}
                        onPress={() => {
                          setEditOptions((current) => current.filter((_, i) => i !== index))
                          setEditCorrectChoice((current) => {
                            if (current === null) return null
                            if (current === index) return null
                            return current > index ? current - 1 : current
                          })
                        }}
                        variant="quiet"
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                )
              })}
              {editOptions.length < 6 && (
                <Button
                  onPress={() => setEditOptions((current) => [...current, { text: '', originalIndex: null }])}
                  variant="secondary"
                  style={{ marginTop: 'var(--space-2)', alignSelf: 'start' }}
                >
                  {reviewMessages.editAddOption}
                </Button>
              )}
            </div>
          ) : (
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
          )}

          {/* Topic/Subtopic/Year display/edit section */}
          {!editing ? (
            <div
              className="review__metadata-row"
              style={{
                display: 'flex',
                gap: 'var(--space-4)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-2)',
                borderTop: '1px solid var(--color-outline)',
              }}
            >
              <span><strong>Topic:</strong> {editTopic || '—'}</span>
              <span><strong>Subtopic:</strong> {editSubtopic || '—'}</span>
              <span><strong>Year:</strong> {editYear || '—'}</span>
            </div>
          ) : (
            <div
              className="review__metadata-row-edit"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 80px',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--color-outline)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)' }}>Topic</span>
                <input
                  type="text"
                  list={topicListId}
                  className="glass-input ds-glass-input__control"
                  value={editTopic}
                  onChange={(e) => setEditTopic(e.target.value)}
                  style={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-outline)',
                    color: 'var(--color-text-strong)',
                    fontSize: 'var(--font-size-sm)',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-input)',
                  }}
                  placeholder="Topic"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)' }}>Subtopic</span>
                <input
                  type="text"
                  list={subtopicListId}
                  className="glass-input ds-glass-input__control"
                  value={editSubtopic}
                  onChange={(e) => setEditSubtopic(e.target.value)}
                  style={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-outline)',
                    color: 'var(--color-text-strong)',
                    fontSize: 'var(--font-size-sm)',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-input)',
                  }}
                  placeholder="Subtopic"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)' }}>Year</span>
                <input
                  type="text"
                  className="glass-input ds-glass-input__control"
                  value={editYear}
                  onChange={(e) => setEditYear(e.target.value)}
                  style={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-outline)',
                    color: 'var(--color-text-strong)',
                    fontSize: 'var(--font-size-sm)',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-input)',
                  }}
                  placeholder="Year"
                />
              </div>
              <datalist id={topicListId}>
                {topics.map((item) => <option key={item.topic} value={item.topic} />)}
              </datalist>
              <datalist id={subtopicListId}>
                {[...new Set(subtopics)].map((value) => <option key={value} value={value} />)}
              </datalist>
            </div>
          )}

          {!editing && (
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
          )}

          {editing ? (
            <div className="review__actions" style={{ marginTop: 'var(--space-4)' }}>
              <Button isDisabled={validation !== null || editSaving} onPress={save}>
                Save changes
              </Button>
              <Button isDisabled={editSaving} onPress={() => setEditing(false)} variant="secondary">
                Cancel
              </Button>
              {rowEdit !== undefined ? (
                <Button isDisabled={editSaving} onPress={revert} variant="quiet">
                  Remove all edits
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="review__actions">
              <Button id={confirmId} isDisabled={selected === undefined} onPress={confirm}>
                {reviewMessages.confirm}
              </Button>
            </div>
          )}
          {editing && validation !== null && (
            <p className="ds-inline-note ds-inline-note--info" role="alert" style={{ marginTop: '8px' }}>
              {validation}
            </p>
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
