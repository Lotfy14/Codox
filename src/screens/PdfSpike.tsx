import { useEffect, useRef, useState } from 'react'
import { GlassPanel } from '../design/components'
import { processPdf } from '../pdf'
import type { PageFailure } from '../pdf'

/**
 * Phase-5 diagnostic surface (`?pdfspike=1`) — the instrument for the
 * 25-page phone stress test. Runs the real page-at-a-time pipeline on a
 * locally chosen PDF and reports per-page timing, JPEG size, text-layer
 * chars, and JS heap where available. Nothing leaves the device.
 *
 * Deliberately reachable in production builds: the stress test runs on
 * the shipped .apk/PWA, not on a dev server.
 */

interface PageStat {
  pageIndex: number
  ms: number
  jpegKB: number
  textChars: number
  heapMB: number | null
}

function usedHeapMB(): number | null {
  const memory = (
    performance as { memory?: { usedJSHeapSize: number } }
  ).memory
  return memory ? Math.round(memory.usedJSHeapSize / (1024 * 1024)) : null
}

export function PdfSpike() {
  const [status, setStatus] = useState('Choose a PDF to start.')
  const [stats, setStats] = useState<readonly PageStat[]>([])
  const [failures, setFailures] = useState<readonly PageFailure[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const thumbnailRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (thumbnailRef.current !== null) {
        URL.revokeObjectURL(thumbnailRef.current)
      }
    },
    [],
  )

  const showThumbnail = (jpeg: Blob) => {
    const url = URL.createObjectURL(jpeg)
    // Only the current page's thumbnail lives — the spike obeys the
    // memory discipline it measures.
    if (thumbnailRef.current !== null) URL.revokeObjectURL(thumbnailRef.current)
    thumbnailRef.current = url
    setThumbnail(url)
  }

  const run = async (file: File) => {
    setRunning(true)
    setStats([])
    setFailures([])
    setSummary(null)
    setStatus(`Reading ${file.name}…`)
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = performance.now()
    let lastMark = startedAt
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await processPdf(
        bytes,
        (page) => {
          const now = performance.now()
          const stat: PageStat = {
            pageIndex: page.pageIndex,
            ms: Math.round(now - lastMark),
            jpegKB: Math.round(page.jpeg.size / 1024),
            textChars: page.text.length,
            heapMB: usedHeapMB(),
          }
          lastMark = now
          setStats((rows) => [...rows, stat])
          setStatus(`Rendering page ${page.pageIndex + 1} of ${page.pageCount}…`)
          showThumbnail(page.jpeg)
        },
        { signal: controller.signal },
      )
      const totalSeconds = (performance.now() - startedAt) / 1000
      setFailures(result.failures)
      setSummary(
        `${result.pageCount} pages · ${totalSeconds.toFixed(1)} s total · ` +
          `failures: ${result.failures.length}`,
      )
      setStatus('Done.')
    } catch (error) {
      setStatus(
        controller.signal.aborted
          ? 'Stopped.'
          : `Failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  return (
    <section aria-labelledby="pdf-spike-heading" className="app-tab-screen">
      <h1 id="pdf-spike-heading">PDF render check</h1>
      <GlassPanel as="div" padding="default">
        <p className="convert-muted">
          Diagnostic surface: renders every page of a PDF one at a time,
          exactly like a real conversion, and reports timing and memory.
          The PDF never leaves this device.
        </p>
        <p className="pdf-spike-controls">
          <input
            accept="application/pdf"
            data-testid="spike-input"
            disabled={running}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) void run(file)
              event.target.value = ''
            }}
            type="file"
          />
          <button
            data-testid="spike-abort"
            disabled={!running}
            onClick={() => abortRef.current?.abort()}
            type="button"
          >
            Stop
          </button>
        </p>
        <p data-testid="spike-status" role="status">
          {status}
        </p>
        {summary !== null ? (
          <p data-testid="spike-summary">
            <strong>{summary}</strong>
          </p>
        ) : null}
        {failures.map((failure) => (
          <p className="convert-inline-note convert-inline-note--danger" key={failure.pageIndex}>
            Page {failure.pageIndex + 1}: {failure.message}
          </p>
        ))}
      </GlassPanel>
      {stats.length > 0 ? (
        <GlassPanel as="div" padding="compact">
          <table className="pdf-spike-table" data-testid="spike-table">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">ms</th>
                <th scope="col">JPEG KB</th>
                <th scope="col">Text chars</th>
                <th scope="col">Heap MB</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr data-testid="spike-row" key={stat.pageIndex}>
                  <td>{stat.pageIndex + 1}</td>
                  <td>{stat.ms}</td>
                  <td>{stat.jpegKB}</td>
                  <td>{stat.textChars}</td>
                  <td>{stat.heapMB ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassPanel>
      ) : null}
      {thumbnail !== null ? (
        <GlassPanel as="div" padding="compact">
          <img
            alt="Most recently rendered page"
            className="pdf-spike-thumbnail"
            src={thumbnail}
          />
        </GlassPanel>
      ) : null}
    </section>
  )
}
