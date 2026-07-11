import { GlassPanel, ThemeSwitcher } from '../design/components'
import { firstRunMessages, keyMessages } from '../copy/messages'

/** Honest placeholders — these tabs become real in Phases 5–7. */

export function ConvertPlaceholder() {
  return (
    <section aria-labelledby="convert-heading" className="app-tab-screen">
      <h1 id="convert-heading">Convert</h1>
      <GlassPanel as="div" padding="default">
        <div className="app-placeholder">
          <h2>Not here yet</h2>
          <p>
            Dropping exam PDFs and converting them arrives in Phase 5 and
            Phase 6. Your Gemini key is already set up under Keys, so
            conversion will work the moment it lands.
          </p>
        </div>
      </GlassPanel>
    </section>
  )
}

export function HistoryPlaceholder() {
  return (
    <section aria-labelledby="history-heading" className="app-tab-screen">
      <h1 id="history-heading">History</h1>
      <GlassPanel as="div" padding="default">
        <div className="app-placeholder">
          <h2>Not here yet</h2>
          <p>
            Past runs, review, and export arrive in Phase 7. Nothing is
            stored here yet.
          </p>
        </div>
      </GlassPanel>
    </section>
  )
}

export function HelpPlaceholder() {
  return (
    <section aria-labelledby="help-heading" className="app-tab-screen">
      <h1 id="help-heading">Help</h1>
      <GlassPanel as="div" padding="default">
        <div className="app-placeholder">
          <h2>What Codox is</h2>
          <p>{firstRunMessages.welcome}</p>
          <p>{firstRunMessages.privacyNotice}</p>
          <p>{keyMessages.keyOwnership}</p>
          <p>The full in-app guide arrives in Phase 7.</p>
        </div>
      </GlassPanel>
      <GlassPanel as="div" padding="default">
        <ThemeSwitcher />
      </GlassPanel>
    </section>
  )
}
