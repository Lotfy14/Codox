import { useEffect, useId, useMemo, useState } from 'react'
import { Badge, Button, GlassPanel, ProgressBar } from '../design/components'
import { exportCopy, reviewCopy } from './copy'
import { reviewFlags } from './mockData'

export interface ReviewMockProps {
  exported: boolean
  fileName: string
  onExport: () => void
  onFinish: () => void
  onResolve: (flagId: string, optionIndex: number) => void
  resolutions: Readonly<Record<string, number>>
}

const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'] as const

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

/**
 * The focused Review takeover: source crop beside the flagged question on
 * desktop, a flippable card on phones, fully keyboard operable
 * (1–4 pick · Enter confirm · ←/→ move · V flip to source).
 */
export function ReviewMock({
  exported,
  fileName,
  onExport,
  onFinish,
  onResolve,
  resolutions,
}: ReviewMockProps) {
  const flags = reviewFlags
  const resolvedCount = useMemo(
    () => flags.filter((flag) => resolutions[flag.id] !== undefined).length,
    [flags, resolutions],
  )
  const allResolved = resolvedCount === flags.length

  const [currentIndex, setCurrentIndex] = useState(() => {
    const firstUnresolved = flags.findIndex(
      (flag) => resolutions[flag.id] === undefined,
    )
    return firstUnresolved === -1 ? 0 : firstUnresolved
  })
  const [showSource, setShowSource] = useState(false)
  const [justResolved, setJustResolved] = useState(false)
  const confirmId = useId()

  const flag = flags[currentIndex]
  const savedChoice = resolutions[flag.id]
  const [selected, setSelected] = useState<number | undefined>(savedChoice)

  // Moving to another flag re-seeds the selection from what is saved for it.
  useEffect(() => {
    setSelected(resolutions[flags[currentIndex].id])
    setShowSource(false)
  }, [currentIndex, flags, resolutions])

  const goTo = (index: number) => {
    if (index >= 0 && index < flags.length) setCurrentIndex(index)
  }

  const confirm = () => {
    if (selected === undefined) return
    onResolve(flag.id, selected)
    setJustResolved(true)
    window.setTimeout(() => setJustResolved(false), 360)
    // Prefer the next unresolved flag after this one, wrapping to the start.
    const isUnresolved = (index: number) =>
      index !== currentIndex && resolutions[flags[index].id] === undefined
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
  }

  useEffect(() => {
    if (allResolved) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return

      const optionIndex = Number.parseInt(event.key, 10) - 1
      if (
        Number.isInteger(optionIndex) &&
        optionIndex >= 0 &&
        optionIndex < flag.options.length
      ) {
        setSelected(optionIndex)
        // Focus lands on Confirm so the next Enter confirms — otherwise it
        // would activate whatever is focused (on takeover entry: Minimize).
        // Deferred: Confirm is disabled until the selection renders.
        window.setTimeout(
          () => document.getElementById(confirmId)?.focus(),
          0,
        )
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
      if (event.key === 'Enter' && !isActivationTarget(event.target)) {
        confirm()
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  if (allResolved) {
    return (
      <section aria-labelledby="mock-review-done-heading" className="mock-review-done">
        <GlassPanel as="div" padding="spacious">
          <p className="mock-done-mark" aria-hidden="true">
            ✓
          </p>
          <h1 id="mock-review-done-heading">{reviewCopy.allResolved}</h1>
          {exported ? (
            <p className="mock-inline-note mock-inline-note--working" role="status">
              {exportCopy.exportDone}
            </p>
          ) : null}
          <div className="mock-done-actions">
            <Button isDisabled={exported} onPress={onExport}>
              {exported ? 'Exported' : 'Export bundle'}
            </Button>
            <Button onPress={onFinish} variant="quiet">
              Back to Convert
            </Button>
          </div>
        </GlassPanel>
      </section>
    )
  }

  return (
    <section aria-labelledby="mock-review-heading" className="mock-review">
      <header className="mock-review__header">
        <div>
          <h1 id="mock-review-heading">Review · {fileName}</h1>
          <p className="mock-muted">
            Flag {currentIndex + 1} of {flags.length} · question{' '}
            {flag.questionNumber}, page {flag.page}
          </p>
        </div>
        <ProgressBar
          className="mock-review__progress"
          label="Flags resolved"
          max={flags.length}
          value={resolvedCount}
        />
      </header>

      <div
        className={`mock-review__split ${
          showSource ? 'mock-review__split--source' : ''
        }`}
      >
        <section
          aria-label={`Source, page ${flag.page}`}
          className="mock-review__source"
        >
          <div className="mock-paper">
            <p className="mock-paper__label">
              Page {flag.page} · {fileName}
            </p>
            <div className="mock-paper__body">
              {flag.sourceLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
          <Button
            className="mock-review__flip"
            onPress={() => setShowSource(false)}
            variant="secondary"
          >
            Back to answer (V)
          </Button>
        </section>

        <section
          aria-label={`Question ${flag.questionNumber}`}
          className={`mock-review__question ${
            justResolved ? 'mock-review__question--tick' : ''
          }`}
        >
          <Badge tone="warning">{reviewCopy.whyFlagged[flag.reason]}</Badge>
          <h2>{flag.question}</h2>
          <div
            aria-label="Pick the correct answer"
            className="mock-review__options"
            role="radiogroup"
          >
            {flag.options.map((option, index) => (
              <button
                aria-checked={selected === index}
                className="mock-option"
                key={option}
                onClick={() => setSelected(index)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className="mock-option__letter">
                  {optionLetters[index]}
                </span>
                <span>{option}</span>
                <kbd aria-hidden="true">{index + 1}</kbd>
              </button>
            ))}
          </div>
          <div className="mock-review__actions">
            <Button id={confirmId} isDisabled={selected === undefined} onPress={confirm}>
              Confirm answer (Enter)
            </Button>
            <Button
              className="mock-review__flip"
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
          <p className="mock-muted mock-review__hint">
            Keyboard: 1–{flag.options.length} pick an answer · Enter confirm ·
            ← → move between flags · V flip to the page.
          </p>
        </section>
      </div>
    </section>
  )
}
