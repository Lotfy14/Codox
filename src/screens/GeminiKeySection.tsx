import { useEffect, useRef, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components/Button'
import { Button, GlassInput, StatusChip } from '../design/components'
import type { StatusChipStatus } from '../design/components'
import { keyMessages } from '../copy/messages'
import { geminiController } from '../providers/controller'
import {
  removeGeminiKey,
  saveGeminiKey,
  useGeminiCredential,
} from '../state/credentials'
import type { KeyValidationStatus } from '../state/types'

export interface GeminiKeySectionProps {
  /** Show the Remove-key action (the API panel does, first run does not). */
  allowRemove?: boolean
}

const statusMessages: Readonly<Record<KeyValidationStatus, string>> = {
  working: keyMessages.working,
  'wrong-key': keyMessages.wrongKey,
  unreachable: keyMessages.unreachable,
  'quota-paused': keyMessages.quotaPaused,
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.8M6.6 6.6C3.8 8.5 2 12 2 12s3.5 7 10 7a10.5 10.5 0 0 0 4.4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  ) : (
    <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <rect height="13" rx="2" width="13" x="9" y="9" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/**
 * The one Google Gemini key field with Replace, Remove, and Check key.
 * The stored key stays in the field, always masked (dots); the eye button
 * reveals it and the copy button puts it on the clipboard — the key never
 * leaves the device otherwise. "Check key" stores any newly pasted key
 * (replacing the previous one) and runs a live validation under it; the
 * outcome is persisted by the controller and rendered here from the
 * credential record, so the panel always shows the last observed Gemini
 * status — in the approved words, with wrong key / can't reach / quota
 * kept visually distinct.
 */
export function GeminiKeySection({ allowRemove = false }: GeminiKeySectionProps) {
  const credential = useGeminiCredential()
  /** null = pristine: the field shows the stored key (masked). */
  const [draft, setDraft] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [showEmptyKeyError, setShowEmptyKeyError] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  const hasKey = credential !== null && credential !== undefined
  const storedKey = hasKey ? credential.apiKey : ''
  const fieldValue = draft ?? storedKey
  const validation = hasKey ? credential.lastValidation?.status : undefined

  const chipStatus: StatusChipStatus = checking
    ? 'checking'
    : (validation ?? 'idle')

  const runCheck = async () => {
    setShowEmptyKeyError(false)
    const pasted = fieldValue.trim()
    if (pasted === '') {
      setShowEmptyKeyError(true)
      return
    }
    setChecking(true)
    try {
      if (pasted !== storedKey) {
        await saveGeminiKey(pasted)
      }
      setDraft(null)
      await geminiController.validateStoredKey()
    } finally {
      setChecking(false)
    }
  }

  const removeKey = async () => {
    setShowEmptyKeyError(false)
    setDraft(null)
    setRevealed(false)
    await removeGeminiKey()
  }

  const copyKey = async () => {
    if (fieldValue === '') return
    try {
      await navigator.clipboard.writeText(fieldValue)
      setCopied(true)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; revealing via the eye still works.
    }
  }

  const isReplacing = draft !== null && draft.trim() !== '' && draft.trim() !== storedKey
  const showWrongKey = !checking && validation === 'wrong-key'
  const showWorking = !checking && validation === 'working'
  const inlineNote =
    !checking && (validation === 'unreachable' || validation === 'quota-paused')
      ? validation
      : undefined

  return (
    <div className="key-section">
      <GlassInput
        description={
          hasKey
            ? 'Your key is saved on this device and shown masked. Paste a new key here to replace it.'
            : 'Paste your Gemini API key from Google AI Studio.'
        }
        errorMessage={
          showEmptyKeyError
            ? keyMessages.emptyKey
            : showWrongKey
              ? keyMessages.wrongKey
              : undefined
        }
        inputProps={{ autoComplete: 'off' }}
        label="Google Gemini API key"
        onChange={(value) => {
          setDraft(value)
          setShowEmptyKeyError(false)
        }}
        status={
          showEmptyKeyError || showWrongKey
            ? 'error'
            : showWorking
              ? 'success'
              : 'default'
        }
        successMessage={showWorking ? keyMessages.working : undefined}
        trailing={
          <>
            <AriaButton
              aria-label={revealed ? keyMessages.hideKey : keyMessages.showKey}
              aria-pressed={revealed}
              className="ds-input-icon-button"
              onPress={() => setRevealed((current) => !current)}
            >
              <EyeIcon open={revealed} />
            </AriaButton>
            <AriaButton
              aria-label={keyMessages.copyKey}
              className="ds-input-icon-button"
              isDisabled={fieldValue === ''}
              onPress={() => void copyKey()}
            >
              <CopyIcon done={copied} />
            </AriaButton>
          </>
        }
        type={revealed ? 'text' : 'password'}
        value={fieldValue}
      />
      <span className="ds-visually-hidden" role="status">
        {copied ? keyMessages.keyCopied : ''}
      </span>

      {inlineNote ? (
        <p className={`key-inline-note key-inline-note--${inlineNote}`} role="status">
          {statusMessages[inlineNote]}
        </p>
      ) : null}

      <div className="key-section__actions">
        <Button
          isLoading={checking}
          loadingLabel="Checking…"
          onPress={() => void runCheck()}
          variant={showWorking && !isReplacing ? 'secondary' : 'primary'}
        >
          {isReplacing && hasKey ? 'Replace & check key' : 'Check key'}
        </Button>
        {allowRemove && hasKey ? (
          <Button isDisabled={checking} onPress={() => void removeKey()} variant="danger">
            Remove key
          </Button>
        ) : null}
        <StatusChip status={chipStatus} />
      </div>

      <p className="key-ownership-note">{keyMessages.keyOwnership}</p>
    </div>
  )
}
