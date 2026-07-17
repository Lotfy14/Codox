import { useEffect, useId, useState } from 'react'
import { Button, GlassInput } from '../design/components'
import type { AiAnswer } from '../engine/solver'
import type { RunState, TopicItem } from '../state/types'
import { reviewMessages } from '../copy/messages'
import {
  clearResolution,
  saveResolution,
  type ReviewRow,
} from './review-data'
import {
  planEditSave,
  saveRowEdit,
  updateAiAnswerIndex,
  type EditBaseline,
  type EditorOption,
  type RowEdit,
} from './review-edits'
import { useCropAssets, type CropAsset } from './useSourceUrls'
import { putArtifact } from '../state/runs'

const optionLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface ReviewRowEditorProps {
  run: RunState
  /** The row as displayed — pristine merged row + any prior edit. */
  reviewRow: ReviewRow
  /** The engine's untouched merged row (edit baselines diff against it). */
  pristineRow: ReviewRow['row']
  edit: RowEdit | undefined
  /** Export-effective topic/subtopic/year when no edit is stored. */
  baseline: EditBaseline
  /** The current confirmed/extracted answer index shown to the tutor. */
  initialCorrect: number | null
  storedResolution: number | undefined
  aiAnswer: AiAnswer | undefined
  runTopics: TopicItem[] | undefined
  onClose: () => void
}

export function ReviewRowEditor({
  run,
  reviewRow,
  pristineRow,
  edit,
  baseline,
  initialCorrect,
  storedResolution,
  aiAnswer,
  runTopics,
  onClose,
}: ReviewRowEditorProps) {
  const rowId = reviewRow.row.id
  const [question, setQuestion] = useState(reviewRow.row.question)
  const [options, setOptions] = useState<EditorOption[]>(() =>
    reviewRow.row.options.map((text, index) => ({ text, originalIndex: index })),
  )
  const [correctChoice, setCorrectChoice] = useState<number | null>(initialCorrect)
  const [answerCleared, setAnswerCleared] = useState(false)
  const [topic, setTopic] = useState(edit?.topic ?? baseline.topic)
  const [subtopic, setSubtopic] = useState(edit?.subtopic ?? baseline.subtopic)
  const [year, setYear] = useState(edit?.year ?? baseline.year)
  const [imageUrls, setImageUrls] = useState<string[]>([...reviewRow.row.image_urls])
  const [saving, setSaving] = useState(false)
  const dbCrops = useCropAssets(run.id, true)
  const [pastedCrops, setPastedCrops] = useState<CropAsset[]>([])
  const [showAllPictures, setShowAllPictures] = useState(false)
  const cropAssets = [...dbCrops, ...pastedCrops]

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (!file) continue
          event.preventDefault()
          try {
            // Convert file to JPEG bytes
            const bytes = await new Promise<Uint8Array>((resolve, reject) => {
              const img = new Image()
              img.src = URL.createObjectURL(file)
              img.onload = () => {
                URL.revokeObjectURL(img.src)
                const canvas = document.createElement('canvas')
                canvas.width = img.naturalWidth
                canvas.height = img.naturalHeight
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                  reject(new Error('Canvas context not available'))
                  return
                }
                ctx.drawImage(img, 0, 0)
                canvas.toBlob(
                  async (blob) => {
                    if (!blob) {
                      reject(new Error('JPEG conversion failed'))
                      return
                    }
                    try {
                      const buffer = await blob.arrayBuffer()
                      resolve(new Uint8Array(buffer))
                    } catch (err) {
                      reject(err)
                    }
                  },
                  'image/jpeg',
                  0.85,
                )
              }
              img.onerror = (err) => {
                reject(err)
              }
            })

            let ext = 'jpg'
            if (item.type === 'image/png') ext = 'png'
            else if (item.type === 'image/gif') ext = 'gif'
            else if (item.type === 'image/webp') ext = 'webp'

            const path = `images/pasted-${crypto.randomUUID()}.${ext}`
            const url = URL.createObjectURL(file)

            await putArtifact({
              runId: run.id,
              kind: 'crop',
              path,
              bytes,
            })

            setPastedCrops((current) => [...current, { path, url }])
            setImageUrls((current) => [...current, path])
          } catch (err) {
            console.error('Failed to paste external image', err)
          }
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('paste', handlePaste)
    }
  }, [run.id])
  const topicListId = useId()
  const subtopicListId = useId()
  const correctGroupName = useId()

  const setOptionText = (index: number, text: string) => {
    setOptions((current) =>
      current.map((option, i) => (i === index ? { ...option, text } : option)),
    )
  }

  const removeOption = (index: number) => {
    setOptions((current) => current.filter((_, i) => i !== index))
    setCorrectChoice((current) => {
      if (current === null) return null
      if (current === index) {
        setAnswerCleared(true)
        return null
      }
      return current > index ? current - 1 : current
    })
  }

  const addOption = () => {
    setOptions((current) => [...current, { text: '', originalIndex: null }])
  }

  const togglePicture = (path: string) => {
    setImageUrls((current) =>
      current.includes(path)
        ? current.filter((linked) => linked !== path)
        : [...current, path],
    )
  }

  const validation =
    question.trim() === ''
      ? reviewMessages.editValidationEmptyQuestion
      : options.length < 2
        ? reviewMessages.editValidationTooFewOptions
        : options.some((option) => option.text.trim() === '')
          ? reviewMessages.editValidationEmptyOption
          : null

  const save = async () => {
    if (validation !== null || saving) return
    setSaving(true)
    try {
      const plan = planEditSave(
        pristineRow,
        reviewRow.row,
        { question, options, correctChoice, topic, subtopic, year, imageUrls },
        baseline,
        storedResolution,
        aiAnswer,
      )
      await saveRowEdit(run.id, rowId, plan.edit)
      if (plan.resolution.kind === 'set') {
        await saveResolution(run.id, rowId, plan.resolution.index)
      } else if (plan.resolution.kind === 'clear') {
        await clearResolution(run.id, rowId)
      }
      if (plan.aiIndex !== undefined) {
        await updateAiAnswerIndex(run.id, rowId, plan.aiIndex)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const revert = async () => {
    if (saving) return
    setSaving(true)
    try {
      await saveRowEdit(run.id, rowId, null)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const topics = runTopics ?? []
  const subtopics =
    topics.find((item) => item.topic === topic.trim())?.subtopics ??
    topics.flatMap((item) => item.subtopics)
  const linkedAssets = cropAssets.filter((asset) => imageUrls.includes(asset.path))
  const unlinkedAssets = cropAssets.filter((asset) => !imageUrls.includes(asset.path))
  const linkedWithoutAsset = imageUrls.filter(
    (path) => !cropAssets.some((asset) => asset.path === path),
  )

  return (
    <form
      aria-label={reviewMessages.editHeading(reviewRow.questionNumber)}
      className="review-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <h3 className="review-editor__heading">
        {reviewMessages.editHeading(reviewRow.questionNumber)}
      </h3>

      <label className="review-editor__field">
        <span className="ds-glass-input__label">{reviewMessages.editQuestionLabel}</span>
        <textarea
          className="glass-input ds-glass-input__control review-editor__question"
          onChange={(event) => setQuestion(event.target.value)}
          rows={Math.min(10, Math.max(3, question.split('\n').length + 1))}
          value={question}
        />
      </label>

      <fieldset className="review-editor__group">
        <legend className="ds-glass-input__label">{reviewMessages.editOptionsLegend}</legend>
        <div className="review-editor__options">
          {options.map((option, index) => {
            const letter = optionLetters[index] ?? String(index + 1)
            return (
              <div className="review-editor__option" key={index}>
                <input
                  aria-label={reviewMessages.editOptionCorrect(letter)}
                  checked={correctChoice === index}
                  className="review-editor__correct"
                  name={correctGroupName}
                  onChange={() => {
                    setCorrectChoice(index)
                    setAnswerCleared(false)
                  }}
                  type="radio"
                />
                <span aria-hidden="true" className="review-option__letter">{letter}</span>
                <input
                  aria-label={reviewMessages.editOptionLabel(letter)}
                  className="glass-input ds-glass-input__control review-editor__option-text"
                  onChange={(event) => setOptionText(index, event.target.value)}
                  type="text"
                  value={option.text}
                />
                <Button
                  aria-label={reviewMessages.editRemoveOption(letter)}
                  onPress={() => removeOption(index)}
                  variant="quiet"
                >
                  ✕
                </Button>
              </div>
            )
          })}
        </div>
        <div className="review-editor__option-actions">
          <Button onPress={addOption} variant="secondary">
            {reviewMessages.editAddOption}
          </Button>
        </div>
        {correctChoice === null ? (
          <p className="ds-inline-note ds-inline-note--info" role="status">
            {answerCleared ? reviewMessages.editAnswerCleared : reviewMessages.editNoCorrect}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="review-editor__group review-editor__meta">
        <GlassInput
          inputProps={{ list: topicListId }}
          label={reviewMessages.editTopicLabel}
          onChange={setTopic}
          value={topic}
        />
        <GlassInput
          inputProps={{ list: subtopicListId }}
          label={reviewMessages.editSubtopicLabel}
          onChange={setSubtopic}
          value={subtopic}
        />
        <GlassInput
          label={reviewMessages.editYearLabel}
          onChange={setYear}
          value={year}
        />
        <datalist id={topicListId}>
          {topics.map((item) => <option key={item.topic} value={item.topic} />)}
        </datalist>
        <datalist id={subtopicListId}>
          {[...new Set(subtopics)].map((value) => <option key={value} value={value} />)}
        </datalist>
        <p className="ds-muted review-editor__hint">{reviewMessages.editMetaHint}</p>
      </fieldset>

      <fieldset className="review-editor__group">
        <legend className="ds-glass-input__label">{reviewMessages.editPicturesLegend}</legend>
        {cropAssets.length === 0 && imageUrls.length === 0 ? (
          <p className="ds-muted">{reviewMessages.editNoPicturesAvailable}</p>
        ) : (
          <>
            {linkedAssets.length === 0 && linkedWithoutAsset.length === 0 ? (
              <p className="ds-muted">{reviewMessages.editNoPictures}</p>
            ) : (
              <div className="review-editor__pictures">
                {linkedAssets.map((asset) => {
                  const position = imageUrls.indexOf(asset.path) + 1
                  return (
                    <button
                      aria-label={reviewMessages.editRemovePicture(position)}
                      aria-pressed={true}
                      className="review-editor__picture"
                      key={asset.path}
                      onClick={() => togglePicture(asset.path)}
                      type="button"
                    >
                      <img alt={reviewMessages.editPictureAlt(asset.path)} src={asset.url} />
                    </button>
                  )
                })}
                {linkedWithoutAsset.map((path) => (
                  <div className="review-editor__picture review-editor__picture--missing" key={path}>
                    <span>{path}</span>
                    <Button
                      aria-label={reviewMessages.editRemovePicture(imageUrls.indexOf(path) + 1)}
                      onPress={() => togglePicture(path)}
                      variant="quiet"
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {unlinkedAssets.length > 0 ? (
              <>
                <Button
                  onPress={() => setShowAllPictures((prev) => !prev)}
                  variant="secondary"
                  className="review-editor__toggle-pictures"
                >
                  {showAllPictures
                    ? 'Hide other pictures in document'
                    : `Other pictures in document (${unlinkedAssets.length})`}
                </Button>
                {showAllPictures && (
                  <div className="review-editor__pictures review-editor__pictures--unlinked">
                    {unlinkedAssets.map((asset) => (
                      <button
                        aria-label={reviewMessages.editAddPicture}
                        aria-pressed={false}
                        className="review-editor__picture review-editor__picture--compact"
                        key={asset.path}
                        onClick={() => togglePicture(asset.path)}
                        type="button"
                      >
                        <img alt={reviewMessages.editPictureAlt(asset.path)} src={asset.url} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </fieldset>

      {validation !== null ? (
        <p className="ds-inline-note ds-inline-note--info" role="alert">{validation}</p>
      ) : null}

      <div className="review__actions">
        <Button isDisabled={validation !== null || saving} type="submit">
          {reviewMessages.editSave}
        </Button>
        <Button isDisabled={saving} onPress={onClose} variant="secondary">
          {reviewMessages.editCancel}
        </Button>
        {edit !== undefined ? (
          <Button isDisabled={saving} onPress={() => void revert()} variant="quiet">
            {reviewMessages.editRevert}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
