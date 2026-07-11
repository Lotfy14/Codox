import { useState } from 'react'
import {
  Button,
  GlassInput,
  GlassPanel,
  Select,
  StatusChip,
} from '../design/components'
import type { SelectOption, StatusChipStatus } from '../design/components'
import { firstRunCopy, keyCopy } from './copy'
import { keyCheckHint, simulateKeyCheck } from './simulateKeyCheck'

const providerOptions: readonly SelectOption[] = [
  { id: 'Groq', label: 'Groq', description: 'Fast free tier — recommended' },
  { id: 'OpenRouter', label: 'OpenRouter', description: 'Many free models' },
  { id: 'Google Gemini', label: 'Google Gemini', description: 'Large free allowance' },
]

export interface FirstRunMockProps {
  onFinish: () => void
}

/** The one-time guided walkthrough: one key → validate → privacy line → app. */
export function FirstRunMock({ onFinish }: FirstRunMockProps) {
  const [provider, setProvider] = useState('Groq')
  const [keyText, setKeyText] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkStatus, setCheckStatus] = useState<StatusChipStatus>('idle')
  const [checkMessage, setCheckMessage] = useState('')

  const keyValidated = checkStatus === 'working'

  const runCheck = () => {
    if (keyText.trim() === '') {
      setCheckStatus('wrong-key')
      setCheckMessage(keyCopy.emptyKey)
      return
    }
    setChecking(true)
    setCheckStatus('checking')
    setCheckMessage(keyCopy.checking)
    window.setTimeout(() => {
      const result = simulateKeyCheck(keyText, provider)
      setChecking(false)
      setCheckStatus(result.status)
      setCheckMessage(result.message)
    }, 900)
  }

  return (
    <div className="mock-first-run">
      <GlassPanel as="section" aria-labelledby="mock-first-run-heading" padding="spacious">
        <header className="mock-first-run__header">
          <img alt="" height="56" src="/logo.svg" width="56" />
          <h1 id="mock-first-run-heading">Welcome to Codox</h1>
          <p>{firstRunCopy.welcome}</p>
        </header>

        <div className="mock-first-run__step">
          <p className="mock-eyebrow">Step 1 of 2 · Your key</p>
          <p>{firstRunCopy.keyStepHelp}</p>
          <Select
            label="Provider"
            onChange={(value) => {
              if (value !== null) setProvider(String(value))
            }}
            options={providerOptions}
            value={provider}
          />
          <GlassInput
            description={keyValidated ? undefined : keyCheckHint}
            errorMessage={checkStatus === 'wrong-key' ? checkMessage : undefined}
            label={`${provider} API key`}
            onChange={(value) => {
              setKeyText(value)
              setCheckStatus('idle')
              setCheckMessage('')
            }}
            status={keyValidated ? 'success' : checkStatus === 'wrong-key' ? 'error' : 'default'}
            successMessage={keyValidated ? checkMessage : undefined}
            type="password"
            value={keyText}
          />
          {checkStatus === 'unreachable' || checkStatus === 'quota-paused' ? (
            <p
              className={`mock-inline-note mock-inline-note--${checkStatus}`}
              role="status"
            >
              {checkMessage}
            </p>
          ) : null}
          <div className="mock-first-run__actions">
            <Button
              isLoading={checking}
              loadingLabel="Checking…"
              onPress={runCheck}
              variant={keyValidated ? 'secondary' : 'primary'}
            >
              Check key
            </Button>
            <StatusChip status={checkStatus} />
          </div>
        </div>

        <div className="mock-first-run__step">
          <p className="mock-eyebrow">Step 2 of 2 · One thing to know</p>
          <p className="mock-privacy-line">{firstRunCopy.privacyNotice}</p>
        </div>

        <div className="mock-first-run__actions mock-first-run__finish">
          <Button isDisabled={!keyValidated} onPress={onFinish}>
            Got it — open Codox
          </Button>
          <Button onPress={onFinish} variant="quiet">
            Skip walkthrough
          </Button>
        </div>
      </GlassPanel>
    </div>
  )
}
