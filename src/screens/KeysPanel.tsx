import { useState } from 'react'
import { Button, GlassPanel } from '../design/components'
import { geminiController } from '../providers/controller'
import { GeminiKeySection } from './GeminiKeySection'

/** The real API-key panel: exactly one Google Gemini key, nothing to add. */
export function KeysPanel() {
  return (
    <div className="key-section">
      <GeminiKeySection allowRemove />
      {import.meta.env.DEV ? <DevTestCall /> : null}
    </div>
  )
}

/** Draws a tiny PNG on a canvas and returns its base64 payload. */
function makeTestImage(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas unavailable')
  context.fillStyle = '#17202a'
  context.fillRect(0, 0, 2, 2)
  context.fillStyle = '#ffffff'
  context.fillRect(1, 1, 1, 1)
  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

/**
 * Phase-4 gate evidence surface (dev only): one small vision call through
 * the controller, so the whole chain — singleton stored key → controller →
 * adapter → Gemini — is exercised exactly as the engine will use it.
 */
function DevTestCall() {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState('Not run.')

  const run = async () => {
    setPending(true)
    setResult('Running…')
    try {
      const outcome = await geminiController.runGeminiRequest({
        prompt:
          'Reply with one short sentence that starts with Codox and mentions what color the image mostly is.',
        images: [{ mimeType: 'image/png', base64Data: makeTestImage() }],
      })
      setResult(
        outcome.ok
          ? `Round-trip OK: ${outcome.text.slice(0, 200)}`
          : `Stopped: ${outcome.kind}`,
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <GlassPanel as="div" padding="default">
        <div className="ds-empty-state">
        <h2>Dev: test image call</h2>
        <p>
          Sends one tiny image through the request controller under the
          stored key. Development builds only.
        </p>
        <div className="key-section__actions">
          <Button
            isLoading={pending}
            loadingLabel="Running…"
            onPress={() => void run()}
            variant="secondary"
          >
            Send test image call
          </Button>
        </div>
        <p>{result}</p>
      </div>
    </GlassPanel>
  )
}
