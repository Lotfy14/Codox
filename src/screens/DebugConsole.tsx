/**
 * The Convert screen's step-timing debug console. Off by default; shown only
 * when the Customize "Show debug console" toggle is on.
 *
 * It reads the on-device diagnostics log (never anything network-bound) and
 * renders, per run, how long each conversion step and each Gemini call took —
 * the executor records these as `engine.timing` events. While a run is still
 * going it also shows the current step with a live elapsed clock, so a stall
 * is visible as it happens. Rows stream in as each unit finishes because the
 * event query is live.
 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { GlassPanel } from '../design/components'
import { debugMessages } from '../copy/messages'
import { listEvents } from '../state/diagnostics'
import type { LogEvent, RunState } from '../state/types'

function formatMs(ms: number): string {
  if (ms >= 60_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  return `${(ms / 1000).toFixed(1)}s`
}

interface TimingRow {
  seq: number
  label: string
  ms: number
}

/** This run's timing events, in execution order. */
function timingsFor(events: readonly LogEvent[], runId: string): TimingRow[] {
  return events
    .filter(
      (event) =>
        event.event === 'engine.timing' &&
        event.runId === runId &&
        event.seq !== undefined,
    )
    .map((event) => ({
      seq: event.seq as number,
      label: typeof event.detail?.label === 'string' ? event.detail.label : '',
      ms: typeof event.detail?.ms === 'number' ? event.detail.ms : 0,
    }))
    .sort((a, b) => a.seq - b.seq)
}

/** A once-per-second clock, live only while a run is still going. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export function DebugConsole({ runs }: { runs: readonly RunState[] }) {
  const events = useLiveQuery(() => listEvents(), []) ?? []
  const anyRunning = runs.some((run) => run.status === 'running')
  const now = useTick(anyRunning)

  if (runs.length === 0) return null

  return (
    <GlassPanel
      aria-label={debugMessages.panelLabel}
      as="section"
      className="ds-debug"
      padding="compact"
    >
      <details className="ds-debug__details" open>
        <summary className="ds-debug__summary">
          {debugMessages.panelTitle}
        </summary>
        <div className="ds-debug__runs">
          {runs.map((run) => {
            const rows = timingsFor(events, run.id)
            const total = rows.reduce((sum, row) => sum + row.ms, 0)
            const running = run.status === 'running'
            const elapsed =
              running && run.stepStartedAt !== undefined
                ? now - run.stepStartedAt
                : undefined
            return (
              <section className="ds-debug__run" key={run.id}>
                {runs.length > 1 ? (
                  <h3 className="ds-debug__run-title">{run.fileName}</h3>
                ) : null}
                {running ? (
                  <p className="ds-debug__now" role="status">
                    {debugMessages.now(run.step)}
                    {elapsed !== undefined ? ` · ${formatMs(elapsed)}` : ''}
                  </p>
                ) : null}
                {rows.length === 0 ? (
                  <p className="ds-muted">{debugMessages.waiting}</p>
                ) : (
                  <ul className="ds-debug__list">
                    {rows.map((row) => (
                      <li className="ds-debug__row" key={row.seq}>
                        <span className="ds-debug__label">{row.label}</span>
                        <span aria-hidden="true" className="ds-debug__dots" />
                        <span className="ds-debug__time">
                          {formatMs(row.ms)}
                        </span>
                      </li>
                    ))}
                    <li className="ds-debug__row ds-debug__row--total">
                      <span className="ds-debug__label">
                        {debugMessages.total}
                      </span>
                      <span aria-hidden="true" className="ds-debug__dots" />
                      <span className="ds-debug__time">{formatMs(total)}</span>
                    </li>
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </details>
    </GlassPanel>
  )
}
