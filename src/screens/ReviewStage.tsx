/**
 * The Review stage — one flagged question at a time, its source crop
 * beside it, fully keyboard operable (1–9 pick · Enter confirm ·
 * ←/→ move · V flip to source on phones · W whole page). Ported from the
 * owner-approved ReviewMock onto real run data.
 *
 * Everything reads from IndexedDB, so review works fully offline on an
 * already-converted run. Only one flag's DOM and one page image exist at
 * a time — the bounded-memory intent of the "virtualized list" line in
 * the build plan.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge, Button, GlassPanel, ProgressBar } from '../design/components'
import { exportMessages, reviewMessages } from '../copy/messages'
import { boxToCropBox } from '../engine/boxes'
import { getPageArtifact } from '../state/runs'
import type { RunState } from '../state/types'
import {
  applyResolutions,
  isFlagged,
  loadReviewData,
  saveResolution,
  useResolutions,
  type ReviewData,
  type ReviewFlag,
} from './review-data'

const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.getAttribute('role') === 'button'
  )
}

interface SourceUrls {
  crop: string | null
  page: string | null
}

/**
 * One flag's source images: the padded region crop and the whole page,
 * both object URLs over the stored page JPEG. Revoked the moment the
 * tutor moves on — one decoded page at a time, per the memory law.
 */
function useSourceUrls(runId: string, flag: ReviewFlag | undefined): SourceUrls {
  const [urls, setUrls] = useState<SourceUrls>({ crop: null, page: null })

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const load = async () => {
      if (flag?.pageIndex == null) {
        setUrls({ crop: null, page: null })
        return
      }
      const artifact = await getPageArtifact(runId, flag.pageIndex)
      if (artifact?.bytes === undefined) {
        if (!cancelled) setUrls({ crop: null, page: null })
        return
      }
      const pageBlob = new Blob(
        [artifact.bytes as Uint8Array<ArrayBuffer>],
        { type: 'image/jpeg' },
      )
      let cropUrl: string | null = null
      if (
        flag.box !== null &&
        artifact.width !== undefined &&
        artifact.height !== undefined
      ) {
        try {
          const { cropJpeg } = await import('../pdf/images')
          const cropBlob = await cropJpeg(
            pageBlob,
            boxToCropBox(flag.box, artifact.width, artifact.height),
          )
          cropUrl = URL.createObjectURL(cropBlob)
        } catch {
          cropUrl = null // fall back to the whole page
        }
      }
      const pageUrl = URL.createObjectURL(pageBlob)
      if (cancelled) {
        if (cropUrl !== null) URL.revokeObjectURL(cropUrl)
        URL.revokeObjectURL(pageUrl)
        return
      }
      if (cropUrl !== null) created.push(cropUrl)
      created.push(pageUrl)
      setUrls({ crop: cropUrl, page: pageUrl })
    }
    void load()
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
      setUrls({ crop: null, page: null })
    }
  }, [runId, flag])

  return urls
}

/** Banner shown only while offline: review needs no connection at all. */
function useOffline(): boolean {
  const [offline, setOffline] = useState(() => !navigator.onLine)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return offline
}

export interface ReviewStageProps {
  run: RunState
  exported: boolean
  onExport: () => void
  onClose: () => void
}

export function ReviewStage({ run, exported, onExport, onClose }: ReviewStageProps) {
  const [data, setData] = useState<ReviewData | null>(null)
  const resolutions = useResolutions(run.id)

  useEffect(() => {
    let cancelled = false
    void loadReviewData(run.id).then((loaded) => {
      if (!cancelled) setData(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [run.id])

  if (data === null || resolutions === undefined) return null
  return (
    <ReviewFlags
      data={data}
      exported={exported}
      onClose={onClose}
      onExport={onExport}
      resolutions={resolutions}
      run={run}
    />
  )
}

function ReviewFlags({
  data,
  exported,
  onClose,
  onExport,
  resolutions,
  run,
}: ReviewStageProps & {
  data: ReviewData
  resolutions: Readonly<Record<string, number>>
}) {
  const flags = data.flags
  const resolvedRows = useMemo(
    () => new Set(
      applyResolutions(data.rows, resolutions)
        .filter((row) => !isFlagged(row))
        .map((row) => row.id),
    ),
    [data.rows, resolutions],
  )
  const resolvedCount = flags.filter((flag) => resolvedRows.has(flag.row.id)).length
  const allResolved = resolvedCount === flags.length

  const [currentIndex, setCurrentIndex] = useState(() => {
    const firstUnresolved = flags.findIndex(
      (flag) => resolutions[flag.row.id] === undefined,
    )
    return firstUnresolved === -1 ? 0 : firstUnresolved
  })
  const [showSource, setShowSource] = useState(false)
  const [wholePage, setWholePage] = useState(false)
  const [justResolved, setJustResolved] = useState(false)
  const confirmId = useId()
  const offline = useOffline()

  const flag = flags[currentIndex] as ReviewFlag | undefined
  const source = useSourceUrls(run.id, flag)
  const [selected, setSelected] = useState<number | undefined>(
    flag === undefined ? undefined : resolutions[flag.row.id],
  )

  // Moving to another flag re-seeds the selection from what is saved for it.
  const flagRowId = flag?.row.id
  const savedForFlag = flagRowId === undefined ? undefined : resolutions[flagRowId]
  useEffect(() => {
    setSelected(savedForFlag)
    setShowSource(false)
    setWholePage(false)
  }, [currentIndex, savedForFlag])

  const goTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < flags.length) setCurrentIndex(index)
    },
    [flags.length],
  )

  const tickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(tickTimer.current), [])

  const confirm = useCallback(() => {
    if (flag === undefined || selected === undefined) return
    void saveResolution(run.id, flag.row.id, selected)
    setJustResolved(true)
    window.clearTimeout(tickTimer.current)
    tickTimer.current = window.setTimeout(() => setJustResolved(false), 360)
    // Prefer the next unresolved flag after this one, wrapping to the start.
    const isUnresolved = (index: number) =>
      index !== currentIndex && resolutions[flags[index].row.id] === undefined
    let next = -1
    for (let index = currentIndex + 1; index < flags.length; index += 1) {
      if (isUnresolved(index)) {
        next = index
        break
      }
    }
    if (next === -1) {
      for (let index = 0; index < currentIndex; index += 1) {
        if (isUnresolved(index)) {
          next = index
          break
        }
      }
    }
    if (next !== -1) setCurrentIndex(next)
  }, [flag, selected, run.id, currentIndex, flags, resolutions])

  useEffect(() => {
    if (allResolved || flag === undefined) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return

      const optionIndex = Number.parseInt(event.key, 10) - 1
      if (
        Number.isInteger(optionIndex) &&
        optionIndex >= 0 &&
        optionIndex < flag.row.options.length
      ) {
        setSelected(optionIndex)
        // Focus lands on Confirm so the next Enter confirms — otherwise it
        // would activate whatever is focused. Deferred: Confirm is
        // disabled until the selection renders.
        window.setTimeout(() => document.getElementById(confirmId)?.focus(), 0)
        event.preventDefault()
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'n') {
        goTo(currentIndex + 1)
        event.preventDefault()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'p') {
        goTo(currentIndex - 1)
        event.preventDefault()
        return
      }
      if (event.key === 'v') {
        setShowSource((current) => !current)
        event.preventDefault()
        return
      }
      if (event.key === 'w') {
        setWholePage((current) => !current)
        event.preventDefault()
        return
      }
      if (event.key === 'Enter' && !isActivationTarget(event.target)) {
        confirm()
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [allResolved, flag, currentIndex, confirmId, goTo, confirm])

  if (allResolved || flag === undefined) {
    return (
      <section aria-labelledby="review-done-heading" className="review-done">
        <GlassPanel as="div" padding="spacious">
          <p aria-hidden="true" className="review-done-mark">
            ✓
          </p>
          <h2 id="review-done-heading">{reviewMessages.allResolved}</h2>
          {exported ? (
            <p className="convert-inline-note convert-inline-note--working" role="status">
              {exportMessages.exportDone}
            </p>
          ) : null}
          <div className="review-done-actions">
            <Button isDisabled={exported} onPress={onExport}>
              {exported ? exportMessages.exported : 'Export bundle'}
            </Button>
            <Button onPress={onClose} variant="quiet">
              Back to results
            </Button>
          </div>
        </GlassPanel>
      </section>
    )
  }

  const imageUrl = wholePage ? source.page : (source.crop ?? source.page)

  return (
    <section aria-labelledby="review-heading" className="review">
      <header className="review__header">
        <div className="review__header-row">
          <div>
            <h2 id="review-heading">Review · {run.fileName}</h2>
            <p className="convert-muted">
              Flag {currentIndex + 1} of {flags.length} · question{' '}
              {flag.questionNumber}
              {flag.pageIndex === null ? '' : `, page ${flag.pageIndex + 1}`}
            </p>
          </div>
          <Button autoFocus onPress={onClose} variant="quiet">
            Back to results
          </Button>
        </div>
        <ProgressBar
          className="review__progress"
          label="Flags resolved"
          max={flags.length}
          value={resolvedCount}
        />
        {offline ? (
          <p className="convert-inline-note convert-inline-note--info" role="status">
            {reviewMessages.offlineIsFine}
          </p>
        ) : null}
      </header>

      <div
        className={`review__split ${showSource ? 'review__split--source' : ''}`}
      >
        <section
          aria-label={
            flag.pageIndex === null
              ? 'Source unavailable'
              : `Source, page ${flag.pageIndex + 1}`
          }
          className="review__source"
        >
          {imageUrl === null ? (
            <p className="convert-muted">
              No source image is stored for this question.
            </p>
          ) : (
            <figure className="review-paper">
              <figcaption className="review-paper__label">
                Page {(flag.pageIndex ?? 0) + 1} · {run.fileName}
                {wholePage ? ' · whole page' : ''}
              </figcaption>
              <img
                alt={`Scanned source for question ${flag.questionNumber}`}
                src={imageUrl}
              />
            </figure>
          )}
          {source.crop !== null && source.page !== null ? (
            <Button
              onPress={() => setWholePage((current) => !current)}
              variant="secondary"
            >
              {wholePage ? 'Back to the question area (W)' : 'Show whole page (W)'}
            </Button>
          ) : null}
          <Button
            className="review__flip"
            onPress={() => setShowSource(false)}
            variant="secondary"
          >
            Back to answer (V)
          </Button>
        </section>

        <section
          aria-label={`Question ${flag.questionNumber}`}
          className={`review__question ${
            justResolved ? 'review__question--tick' : ''
          }`}
        >
          <Badge tone="warning">{reviewMessages.whyFlagged[flag.category]}</Badge>
          <h3>{flag.row.question}</h3>
          <div
            aria-label="Pick the correct answer"
            className="review__options"
            role="radiogroup"
          >
            {flag.row.options.map((option, index) => (
              <button
                aria-checked={selected === index}
                className="review-option"
                key={`${flag.row.id}-${index}`}
                onClick={() => setSelected(index)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className="review-option__letter">
                  {optionLetters[index] ?? index + 1}
                </span>
                <span>{option}</span>
                <kbd aria-hidden="true">{index + 1}</kbd>
              </button>
            ))}
          </div>
          <div className="review__actions">
            <Button
              id={confirmId}
              isDisabled={selected === undefined}
              onPress={confirm}
            >
              Confirm answer (Enter)
            </Button>
            <Button
              className="review__flip"
              onPress={() => setShowSource(true)}
              variant="secondary"
            >
              View source (V)
            </Button>
            <Button
              isDisabled={currentIndex === 0}
              onPress={() => goTo(currentIndex - 1)}
              variant="quiet"
            >
              Previous (←)
            </Button>
            <Button
              isDisabled={currentIndex === flags.length - 1}
              onPress={() => goTo(currentIndex + 1)}
              variant="quiet"
            >
              Next (→)
            </Button>
          </div>
          <p className="convert-muted review__hint">
            Keyboard: 1–{flag.row.options.length} pick an answer · Enter
            confirm · ← → move between flags · V flip to the page · W whole
            page. Unsure? Skip it — unresolved answers export blank and
            marked for review, never guessed.
          </p>
        </section>
      </div>
    </section>
  )
}
