import { GlassPanel } from '../design/components'
import { appMessages, historyMessages } from '../copy/messages'

export function History() {
  return (
    <section aria-labelledby="history-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="history-heading">{appMessages.navHistory}</h1>
      </header>
      <GlassPanel as="div" padding="default">
        <div className="ds-empty-state">
          <h2>{historyMessages.emptyTitle}</h2>
          <p>{historyMessages.emptyBody}</p>
        </div>
      </GlassPanel>
    </section>
  )
}
