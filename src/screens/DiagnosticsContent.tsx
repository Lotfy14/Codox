import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { fileSave } from 'browser-fs-access'
import { Button, Toggle } from '../design/components'
import { diagnosticsMessages } from '../copy/messages'
import { clearEvents, exportEventsBlob, listEvents } from '../state/diagnostics'
import { db } from '../state/db'
import {
  benchmarkEncoders,
  formatEncoderResult,
  type EncoderResult,
} from '../pdf/encoder-bench'
import {
  resetEncoderSelection,
  selectEncoderId,
  type EncoderId,
} from '../pdf/encoder-select'

const ENCODER_LABELS: Record<EncoderId, string> = {
  offscreen: 'OffscreenCanvas',
  dom: 'HTMLCanvasElement',
  wasm: 'MozJPEG / WASM',
}
import type { LogEvent } from '../state/types'

interface RunGroup {
  key: string
  label: string
  events: LogEvent[]
}

function groupByRun(events: readonly LogEvent[], runNames: ReadonlyMap<string, string>): RunGroup[] {
  const groups: RunGroup[] = []
  const byKey = new Map<string, RunGroup>()
  for (const event of events) {
    const key = event.runId ?? '__none__'
    let group = byKey.get(key)
    if (group === undefined) {
      const label = key === '__none__'
        ? diagnosticsMessages.generalGroup
        : (runNames.get(key) ?? `Run ${key.slice(0, 8)}`)
      group = { key, label, events: [] }
      byKey.set(key, group); groups.push(group)
    }
    group.events.push(event)
  }
  return groups
}

function sanitizeName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'run'
}

async function downloadDiagnostics(seqs: number[] | undefined, base: string) {
  const blob = await exportEventsBlob(seqs)
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `codox-diagnostics_${base}_${date}.json`
  const file = new File([blob], fileName, { type: 'application/json' })
  // ponytail: fileSave covers web + Tauri + the Firefox/Safari anchor
  // fallback. If Android-APK diagnostics download is ever needed, add the
  // Capacitor Share branch from src/export/exporter.ts.
  try {
    await fileSave(file, { fileName, extensions: ['.json'] })
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
  const runs = useLiveQuery(() => db.runs.toArray(), []) ?? []
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  // DIAGNOSTIC (2026-07-19): encoder benchmark, see src/pdf/encoder-bench.ts.
  const [benchResults, setBenchResults] = useState<EncoderResult[]>([])
  const [benchRunning, setBenchRunning] = useState(false)

  const [chosenEncoder, setChosenEncoder] = useState<string | null>(null)

  const runBenchmark = async () => {
    setBenchResults([])
    setBenchRunning(true)
    try {
      // Re-probe rather than reading the memoized pick, so the label reflects
      // this device now and can be compared against the full-page timings.
      resetEncoderSelection()
      setChosenEncoder(ENCODER_LABELS[await selectEncoderId()])
      await benchmarkEncoders((result) => {
        setBenchResults((previous) => [...previous, result])
      })
    } finally {
      setBenchRunning(false)
    }
  }

  const runNames = new Map(runs.map((run) => [run.id, run.fileName]))
  const shown = problemsOnly
    ? events.filter((event) => event.level !== 'info')
    : events
  const groups = groupByRun(shown, runNames)
  const liveSeqs = new Set(seqsOf(events))
  const selectedLive = [...selected].filter((seq) => liveSeqs.has(seq))

  const selectedEvents = events.filter((event) => event.seq !== undefined && selected.has(event.seq))
  const selectionRunIds = new Set(selectedEvents.map((event) => event.runId ?? '__none__'))
  const selectionBase = selectionRunIds.size === 1
    ? (() => {
        const only = [...selectionRunIds][0]
        const name = only === '__none__' ? undefined : runNames.get(only)
        return name ? sanitizeName(name) : 'selection'
      })()
    : 'selection'

  const toggleOne = (seq: number | undefined) => {
    if (seq === undefined) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(seq)) next.delete(seq)
      else next.add(seq)
      return next
    })
  }

  const toggleRun = (group: RunGroup) => {
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
      {/* DIAGNOSTIC (2026-07-19): remove with src/pdf/encoder-bench.ts once the
          Android encoder choice is settled. */}
      <section className="ds-diagnostics__day">
        <div className="ds-diagnostics__day-head">
          <h3 className="ds-diagnostics__day-title">Image encoder benchmark</h3>
        </div>
        <p className="ds-muted">
          Measures how fast this device encodes one page image. Used to diagnose
          slow conversions; runs entirely on your device and sends nothing.
        </p>
        <Button
          isDisabled={benchRunning}
          onPress={() => void runBenchmark()}
          variant="secondary"
        >
          {benchRunning ? 'Measuring…' : 'Run benchmark'}
        </Button>
        {chosenEncoder !== null ? (
          <p className="ds-muted">
            This device converts using: <strong>{chosenEncoder}</strong>
          </p>
        ) : null}
        {benchResults.length > 0 ? (
          <ul className="ds-diagnostics__list">
            {benchResults.map((result) => (
              <li className="ds-diagnostics__row" key={result.name}>
                {formatEncoderResult(result)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <div className="ds-diagnostics__actions">
        <Toggle
          isSelected={problemsOnly}
          label={diagnosticsMessages.problemsOnly}
          onChange={setProblemsOnly}
        />
        <div className="ds-diagnostics__buttons">
          <Button isDisabled={events.length === 0} onPress={() => void downloadDiagnostics(undefined, 'all')} variant="secondary">
            {diagnosticsMessages.downloadAll}
          </Button>
          <Button isDisabled={selectedLive.length === 0} onPress={() => void downloadDiagnostics(selectedLive, selectionBase)} variant="secondary">
            {diagnosticsMessages.downloadSelected(selectedLive.length)}
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
                    aria-label={diagnosticsMessages.selectGroup(group.label)}
                    checked={allSelected}
                    className="ds-diagnostics__check"
                    onChange={() => toggleRun(group)}
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
                              {new Date(event.t).toLocaleString()}
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