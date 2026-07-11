import { useRef, useState } from 'react'
import {
  Button,
  GlassInput,
  GlassPanel,
  ProviderOrderList,
} from '../design/components'
import type { ProviderOrderItem } from '../design/components'
import { keyCopy } from './copy'
import { keyCheckHint, simulateKeyCheck } from './simulateKeyCheck'

export interface KeysMockProps {
  onProvidersChange: (providers: ProviderOrderItem[]) => void
  providers: readonly ProviderOrderItem[]
}

/** The Keys tab: one card per provider, live checks, drag-to-reorder chain. */
export function KeysMock({ onProvidersChange, providers }: KeysMockProps) {
  // Key fields are uncontrolled and read at check time: the reorder list
  // caches item renders by item identity, so per-keystroke state would go
  // stale inside its render closures.
  const inputRefs = useRef(new Map<string, HTMLInputElement | null>())
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [checkingId, setCheckingId] = useState<string | null>(null)

  const setProviderStatus = (
    id: string,
    status: ProviderOrderItem['status'],
  ) => {
    onProvidersChange(
      providers.map((provider) =>
        provider.id === id ? { ...provider, status } : provider,
      ),
    )
  }

  const checkKey = (provider: ProviderOrderItem) => {
    const keyText = inputRefs.current.get(provider.id)?.value ?? ''
    if (keyText.trim() === '') {
      setMessages((current) => ({ ...current, [provider.id]: keyCopy.emptyKey }))
      setProviderStatus(provider.id, 'wrong-key')
      return
    }
    setCheckingId(provider.id)
    setProviderStatus(provider.id, 'checking')
    setMessages((current) => ({ ...current, [provider.id]: keyCopy.checking }))
    window.setTimeout(() => {
      const result = simulateKeyCheck(keyText, provider.name)
      setCheckingId(null)
      setProviderStatus(provider.id, result.status)
      setMessages((current) => ({ ...current, [provider.id]: result.message }))
    }, 900)
  }

  return (
    <section aria-labelledby="mock-keys-heading" className="mock-screen">
      <header className="mock-screen__header">
        <h1 id="mock-keys-heading">Keys</h1>
        <p>{keyCopy.failoverExplainer}</p>
      </header>

      <GlassPanel as="section" aria-label="Your providers" padding="compact">
        <ProviderOrderList
          items={[...providers]}
          onReorder={onProvidersChange}
          renderDetails={(provider) => {
            const message = messages[provider.id]
            const status = provider.status
            return (
              <div className="mock-provider-details">
                <GlassInput
                  description={message === undefined ? keyCheckHint : undefined}
                  errorMessage={status === 'wrong-key' ? message : undefined}
                  inputRef={(element) => {
                    inputRefs.current.set(provider.id, element)
                  }}
                  label={`${provider.name} API key`}
                  status={
                    status === 'working' && message !== undefined
                      ? 'success'
                      : status === 'wrong-key'
                        ? 'error'
                        : 'default'
                  }
                  successMessage={
                    status === 'working' && message !== undefined
                      ? message
                      : undefined
                  }
                  type="password"
                />
                {status === 'unreachable' || status === 'quota-paused' ? (
                  <p
                    className={`mock-inline-note mock-inline-note--${status}`}
                    role="status"
                  >
                    {message}
                  </p>
                ) : null}
                <Button
                  isLoading={checkingId === provider.id}
                  loadingLabel="Checking…"
                  onPress={() => checkKey(provider)}
                  variant="secondary"
                >
                  Check key
                </Button>
              </div>
            )
          }}
        />
      </GlassPanel>
    </section>
  )
}
