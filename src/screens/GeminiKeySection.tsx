import { useState } from 'react'
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

/**
 * The one Google Gemini key field with Replace, Remove, and Check key.
 * "Check key" stores any newly pasted key (replacing the previous one) and
 * runs a live validation under it; the outcome is persisted by the
 * controller and rendered here from the credential record, so the panel
 * always shows the last observed Gemini status — in the approved words,
 * with wrong key / can't reach / quota kept visually distinct.
 */
export function GeminiKeySection({ allowRemove = false }: GeminiKeySectionProps) {
  const credential = useGeminiCredential()
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [showEmptyKeyError, setShowEmptyKeyError] = useState(false)

  const hasKey = credential !== null && credential !== undefined
  const validation = hasKey ? credential.lastValidation?.status : undefined

  const chipStatus: StatusChipStatus = checking
    ? 'checking'
    : (validation ?? 'idle')

  const runCheck = async () => {
    setShowEmptyKeyError(false)
    const pasted = draft.trim()
    if (pasted === '' && !hasKey) {
      setShowEmptyKeyError(true)
      return
    }
    setChecking(true)
    try {
      if (pasted !== '') {
        await saveGeminiKey(pasted)
        setDraft('')
      }
      await geminiController.validateStoredKey()
    } finally {
      setChecking(false)
    }
  }

  const removeKey = async () => {
    setShowEmptyKeyError(false)
    setDraft('')
    await removeGeminiKey()
  }

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
            ? 'A key is saved on this device. Paste a new key here to replace it.'
            : 'Paste your Gemini API key from Google AI Studio.'
        }
        errorMessage={
          showEmptyKeyError
            ? keyMessages.emptyKey
            : showWrongKey
              ? keyMessages.wrongKey
              : undefined
        }
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
        type="password"
        value={draft}
      />

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
          variant={showWorking && draft.trim() === '' ? 'secondary' : 'primary'}
        >
          {draft.trim() !== '' && hasKey ? 'Replace & check key' : 'Check key'}
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
