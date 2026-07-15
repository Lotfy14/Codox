import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { fileSave } from 'browser-fs-access'
import { Button, Toggle } from '../design/components'
import { diagnosticsMessages } from '../copy/messages'
import { clearEvents, exportEventsBlob, listEvents } from '../state/diagnostics'
import type { LogEvent } from '../state/types'

interface DayGroup {
  key: string
  label: string
  events: LogEvent[]
}

function dayLabel(date: Date): string {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfThatDay = new Date(date)
  startOfThatDay.setHours(0, 0, 0, 0)
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfThatDay.getTime()) / 86_400_000,
  )
  if (dayDiff === 0) return diagnosticsMessages.today
  if (dayDiff === 1) return diagnosticsMessages.yesterday
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function groupByDay(events: readonly LogEvent[]): DayGroup[] {
  const groups: DayGroup[] = []
  const byKey = new Map<string, DayGroup>()
  for (const event of events) {
    const date = new Date(event.t)
    const key = date.toDateString()
    let group = byKey.get(key)
    if (group === undefined) {
      group = { key, label: dayLabel(date), events: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.events.push(event)
  }
  return groups
}

async function downloadDiagnostics() {
  const blob = await exportEventsBlob()
  const file = new File([blob], 'codox-diagnostics.json', {
    type: 'application/json',
  })
  // ponytail: fileSave covers web + Tauri + the Firefox/Safari anchor
  // fallback. If Android-APK diagnostics download is ever needed, add the
  // Capacitor Share branch from src/export/exporter.ts.
  try {
    await fileSave(file, {
      fileName: 'codox-diagnostics.json',
      extensions: ['.json'],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    throw error
  }
}

function seqsOf(events: readonly LogEvent[]): number[] {
  return events
    .map((event) => event.seq)
    .filter((seq): seq is number => seq !== undefined)
}

export function DiagnosticsContent() {
  const events = useLiveQuery(() => listEvents(), []) ?? []
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())

  const shown = problemsOnly
    ? events.filter((event) => event.level !== 'info')
    : events
  const groups = groupByDay(shown)
  const liveSeqs = new Set(seqsOf(events))
  const selectedLive = [...selected].filter((seq) => liveSeqs.has(seq))

  const toggleOne = (seq: number | undefined) => {
    if (seq === undefined) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(seq)) next.delete(seq)
      else next.add(seq)
      return next
    })
  }

  const toggleDay = (group: DayGroup) => {
    const seqs = seqsOf(group.events)
    const allSelected = seqs.length > 0 && seqs.every((seq) => selected.has(seq))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const seq of seqs) {
        if (allSelected) next.delete(seq)
        else next.add(seq)
      }
      return next
    })
  }

  const clearSelected = async () => {
    await clearEvents(selectedLive)
    setSelected(new Set())
  }

  const clearAll = async () => {
    await clearEvents()
    setSelected(new Set())
  }

  return (
    <div className="ds-stack ds-diagnostics">
      <div className="ds-diagnostics__actions">
        <Toggle
          isSelected={problemsOnly}
          label={diagnosticsMessages.problemsOnly}
          onChange={setProblemsOnly}
        />
        <div className="ds-diagnostics__buttons">
          <Button
            isDisabled={events.length === 0}
            onPress={() => void downloadDiagnostics()}
            variant="secondary"
          >
            {diagnosticsMessages.download}
          </Button>
          <Button
            isDisabled={selectedLive.length === 0}
            onPress={() => void clearSelected()}
            variant="danger"
          >
            {diagnosticsMessages.clearSelected(selectedLive.length)}
          </Button>
          <Button
            isDisabled={events.length === 0}
            onPress={() => void clearAll()}
            variant="quiet"
          >
            {diagnosticsMessages.clearAll}
          </Button>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="ds-muted">{diagnosticsMessages.empty}</p>
      ) : (
        <div className="ds-diagnostics__days">
          {groups.map((group) => {
            const seqs = seqsOf(group.events)
            const allSelected =
              seqs.length > 0 && seqs.every((seq) => selected.has(seq))
            const someSelected = seqs.some((seq) => selected.has(seq))
            return (
              <section className="ds-diagnostics__day" key={group.key}>
                <div className="ds-diagnostics__day-head">
                  <input
                    aria-label={diagnosticsMessages.selectDay(group.label)}
                    checked={allSelected}
                    className="ds-diagnostics__check"
                    onChange={() => toggleDay(group)}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected
                    }}
                    type="checkbox"
                  />
                  <h3 className="ds-diagnostics__day-title">{group.label}</h3>
                  <span className="ds-diagnostics__day-count">
                    {diagnosticsMessages.eventCount(group.events.length)}
                  </span>
                </div>
                <ul className="ds-diagnostics__list">
                  {group.events.map((event) => {
                    const isSelected =
                      event.seq !== undefined && selected.has(event.seq)
                    const rowClass = [
                      'ds-diagnostics__row',
                      `ds-diagnostics__row--${event.level}`,
                      isSelected ? 'ds-diagnostics__row--selected' : undefined,
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <li className={rowClass} key={event.seq}>
                        <input
                          aria-label={diagnosticsMessages.selectEvent(
                            event.event,
                          )}
                          checked={isSelected}
                          className="ds-diagnostics__check"
                          onChange={() => toggleOne(event.seq)}
                          type="checkbox"
                        />
                        <div className="ds-diagnostics__row-body">
                          <div className="ds-diagnostics__meta">
                            <span className="ds-diagnostics__time">
                              {new Date(event.t).toLocaleTimeString()}
                            </span>
                            <span className="ds-diagnostics__event">
                              {event.scope} · {event.event}
                            </span>
                          </div>
                          {event.reason ? (
                            <p className="ds-diagnostics__reason">
                              {event.reason}
                            </p>
                          ) : null}
                          {event.detail ? (
                            <details className="ds-diagnostics__detail">
                              <summary>{diagnosticsMessages.detail}</summary>
                              <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                            </details>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}