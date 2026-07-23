import { useEffect, useRef } from 'react'
import { Button } from '../design/components'
import { coachmarkMessages, keyMessages } from '../copy/messages'
import { openExternal } from '../external-open'

export interface ApiCoachmarkProps {
  onDismiss: () => void
  onOpenApi: () => void
}

/** A dismissible first-use pointer to the API-key control. */
export function ApiCoachmark({ onDismiss, onOpenApi }: ApiCoachmarkProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  return (
    <div className="api-coachmark-layer">
      <div
        aria-hidden="true"
        className="api-coachmark__backdrop"
        onClick={onDismiss}
      />
      <section
        aria-labelledby="api-coachmark-title"
        className="api-coachmark"
        role="dialog"
      >
        <button
          aria-label={coachmarkMessages.dismiss}
          className="api-coachmark__close"
          onClick={onDismiss}
          ref={closeRef}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
        <span aria-hidden="true" className="api-coachmark__eyebrow">
          {coachmarkMessages.eyebrow}
        </span>
        <h2 id="api-coachmark-title">{coachmarkMessages.title}</h2>
        <p>
          {coachmarkMessages.bodyBeforeKey}
          <strong>{coachmarkMessages.bodyKey}</strong>
          {coachmarkMessages.bodyBeforeAction}
          <strong>{coachmarkMessages.bodyAction}</strong>.
        </p>
        <p className="api-coachmark__studio-link">
          <strong>{keyMessages.aiStudioAccountAction}</strong>
          {keyMessages.aiStudioBeforeLink}
          <a
            href={keyMessages.aiStudioUrl}
            onClick={(event) => {
              event.preventDefault()
              void openExternal(keyMessages.aiStudioUrl)
            }}
            rel="noreferrer"
            target="_blank"
          >
            {keyMessages.aiStudioLink}
          </a>
          {keyMessages.aiStudioBeforeKey}
          <strong>{keyMessages.aiStudioKey}</strong>
          {keyMessages.aiStudioBeforePaste}
          <strong>{keyMessages.aiStudioPasteAction}</strong>.
        </p>
        <Button onPress={onOpenApi}>{coachmarkMessages.action}</Button>
      </section>
    </div>
  )
}
