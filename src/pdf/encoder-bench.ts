/**
 * DIAGNOSTIC (2026-07-19): on-device JPEG encoder benchmark.
 *
 * Page encoding measured ~40x slower inside Capacitor's Android WebView than
 * in Chrome on the same phone (200s vs 5s for the same pages), which is a
 * canvas/Skia cost, not JPEG maths. Desktop numbers cannot settle which
 * replacement to ship, because canvas is precisely the thing that differs
 * between the two shells — so the candidates are measured on the device.
 *
 * Remove this file, its Help-screen entry point, and `bitmapToJpegViaWasm`
 * once the encoder choice is made.
 */
import { PAGE_JPEG_QUALITY, bitmapToJpegViaWasm } from './images'
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

function pixelView(bitmap: PageBitmap): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(
    bitmap.data.buffer,
    bitmap.data.byteOffset,
    bitmap.data.byteLength,
  ) as Uint8ClampedArray<ArrayBuffer>
}

async function encodeViaOffscreenCanvas(bitmap: PageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  try {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d context')
    context.putImageData(
      new ImageData(pixelView(bitmap), bitmap.width, bitmap.height),
      0,
      0,
    )
    return await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: PAGE_JPEG_QUALITY,
    })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

async function encodeViaDomCanvas(bitmap: PageBitmap): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d context')
    context.putImageData(
      new ImageData(pixelView(bitmap), bitmap.width, bitmap.height),
      0,
      0,
    )
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob !== null ? resolve(blob) : reject(new Error('toBlob returned null')),
        'image/jpeg',
        PAGE_JPEG_QUALITY,
      )
    })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
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
export async function benchmarkEncoders(
  onResult?: (result: EncoderResult) => void,
): Promise<EncoderResult[]> {
  const bitmap = makePageBitmap()
  const results: EncoderResult[] = []

  const candidates: Array<[string, (b: PageBitmap) => Promise<Blob>]> = [
    ...(typeof OffscreenCanvas !== 'undefined'
      ? ([['OffscreenCanvas (current)', encodeViaOffscreenCanvas]] as const)
      : []),
    ['HTMLCanvasElement', encodeViaDomCanvas],
    ['MozJPEG / WASM', (b) => bitmapToJpegViaWasm(b)],
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
