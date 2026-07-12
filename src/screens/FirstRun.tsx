import { Button, GlassPanel } from '../design/components'
import { firstRunMessages } from '../copy/messages'
import { markFirstRunCompleted } from '../state/settings'
import { useGeminiCredential } from '../state/credentials'
import { GeminiKeySection } from './GeminiKeySection'

export interface FirstRunProps {
  onDone: () => void
}

/**
 * The one-time walkthrough: one Gemini key → live validation → the
 * one-line privacy notice → Convert. Skipping is allowed; the key can be
 * entered later through the API-key panel.
 */
export function FirstRun({ onDone }: FirstRunProps) {
  const credential = useGeminiCredential()
  const keyValidated = credential?.lastValidation?.status === 'working'

  const finish = async () => {
    await markFirstRunCompleted()
    onDone()
  }

  return (
    <div className="ds-stage first-run">
      <GlassPanel aria-labelledby="first-run-heading" as="section" padding="spacious">
        <header className="first-run__header">
          <img alt="" className="first-run__logo" height="56" src="/brand-logo.png" width="56" />
          <h1 id="first-run-heading">Welcome to Codox</h1>
          <p>{firstRunMessages.welcome}</p>
        </header>

        <div className="first-run__step">
          <GeminiKeySection />
        </div>

        <div className="first-run__step">
          <p className="first-run__privacy">{firstRunMessages.privacyNotice}</p>
        </div>

        <div className="first-run__finish">
          <Button isDisabled={!keyValidated} onPress={() => void finish()}>
            Open Codox
          </Button>
          <Button onPress={() => void finish()} variant="quiet">
            Skip for now
          </Button>
        </div>
      </GlassPanel>
    </div>
  )
}
