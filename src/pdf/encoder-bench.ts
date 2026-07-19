/**
 * On-device JPEG encoder benchmark, surfaced in the Diagnostics panel.
 *
 * Full-page timings for all candidates, which is how the Android encode
 * problem was found and settled. The pipeline itself does not use this — it
 * runs the much cheaper probe in encoder-select.ts — but this stays as the
 * tool for re-checking a device when conversions are slow, and for confirming
 * the probe picked the encoder a full-page measurement agrees with.
 */
import {
  encodeViaDomCanvas,
  encodeViaOffscreenCanvas,
  encodeViaWasm,
} from './images'
import type { PageBitmap } from './types'

/** A4 at the pinned 200 DPI render — the real per-page shape. */
const WIDTH = 1654
const HEIGHT = 2339

/** One warm-up pass (WASM init, JIT) plus this many timed passes. */
const TIMED_PASSES = 2

export interface EncoderResult {
  name: string
  /** Mean milliseconds per page, or null when unavailable on this device. */
  msPerPage: number | null
  /** Encoded size in KB — a sanity check that it really produced a JPEG. */
  kb: number
  /** Why it is unavailable, when msPerPage is null. */
  note?: string
}

/**
 * Page-like synthetic content: text-ish blocks on near-white. Flat colour
 * would compress unrealistically fast and flatter every candidate equally.
 */
function makePageBitmap(): PageBitmap {
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4
      const ink = x % 97 < 40 && y % 53 < 20
      data[i] = ink ? 20 : 250 - (x % 6)
      data[i + 1] = ink ? 20 : 248
      data[i + 2] = ink ? 30 : 245
      data[i + 3] = 255
    }
  }
  return { pageIndex: 0, width: WIDTH, height: HEIGHT, data }
}

async function measure(
  name: string,
  encode: (bitmap: PageBitmap) => Promise<Blob>,
  bitmap: PageBitmap,
): Promise<EncoderResult> {
  try {
    // Warm-up: pays WASM instantiation and first-call JIT for every candidate
    // alike, so the timed passes compare steady-state cost.
    const warm = await encode(bitmap)
    let total = 0
    let bytes = warm.size
    for (let pass = 0; pass < TIMED_PASSES; pass += 1) {
      const startedAt = performance.now()
      const blob = await encode(bitmap)
      total += performance.now() - startedAt
      bytes = blob.size
    }
    return {
      name,
      msPerPage: Math.round(total / TIMED_PASSES),
      kb: Math.round(bytes / 1024),
    }
  } catch (error) {
    return {
      name,
      msPerPage: null,
      kb: 0,
      note: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Run every candidate encoder once on this device. `onResult` fires as each
 * finishes so the UI can fill in incrementally — on a slow phone the canvas
 * candidates can take tens of seconds and a frozen-looking panel reads as a
 * crash.
 */
type Candidate = [string, (bitmap: PageBitmap) => Promise<Blob>]

const offscreenCandidate: Candidate = [
  'OffscreenCanvas (current)',
  encodeViaOffscreenCanvas,
]

export async function benchmarkEncoders(
  onResult?: (result: EncoderResult) => void,
): Promise<EncoderResult[]> {
  const bitmap = makePageBitmap()
  const results: EncoderResult[] = []

  const candidates: Candidate[] = [
    // OffscreenCanvas is absent in older WebViews; the app falls back to a
    // DOM canvas there, so only measure it where it actually exists.
    ...(typeof OffscreenCanvas !== 'undefined'
      ? [offscreenCandidate]
      : []),
    ['HTMLCanvasElement', encodeViaDomCanvas],
    ['MozJPEG / WASM', encodeViaWasm],
  ]

  if (typeof OffscreenCanvas === 'undefined') {
    const unavailable: EncoderResult = {
      name: 'OffscreenCanvas (current)',
      msPerPage: null,
      kb: 0,
      note: 'not available in this WebView',
    }
    results.push(unavailable)
    onResult?.(unavailable)
  }

  for (const [name, encode] of candidates) {
    const result = await measure(name, encode, bitmap)
    results.push(result)
    onResult?.(result)
    // Yield to the event loop so the UI can paint between candidates.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return results
}

/** "OffscreenCanvas (current): 7700 ms/page (236 KB)" */
export function formatEncoderResult(result: EncoderResult): string {
  if (result.msPerPage === null) {
    return `${result.name}: unavailable — ${result.note ?? 'unknown'}`
  }
  const perDoc = ((result.msPerPage * 200) / 1000).toFixed(0)
  return `${result.name}: ${result.msPerPage} ms/page (${result.kb} KB) — ${perDoc}s per 200 pages`
}
