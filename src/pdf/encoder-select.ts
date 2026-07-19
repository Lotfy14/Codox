/**
 * Picks this device's fastest JPEG encoder by measuring it, once per session.
 *
 * Page encoding is the dominant render cost, and which route is fastest is not
 * predictable from the platform (measured 2026-07-19, ms per A4 page at 200
 * DPI):
 *
 *              OffscreenCanvas  DOM canvas  MozJPEG/WASM
 *   desktop web        174          95          432
 *   Windows app         83         204          417
 *   Android APK       8500        4109          331
 *
 * Canvas wins by ~4x where it works, loses by 26x inside Capacitor's Android
 * WebView (a Skia bitmap/readback cost, not JPEG maths), and the two canvas
 * flavours trade places between the two desktop shells. So this measures
 * rather than branching on platform — no `if (android)` anywhere, one code
 * path everywhere, and a WebView that fixes canvas later is picked up
 * automatically.
 *
 * The probe is deliberately small and sequential: at PROBE_SIZE it costs well
 * under a second even on the slowest device measured, while three concurrent
 * full-page encodes would put three ~15 MB canvas backing stores in flight
 * against the ~100 MB mobile budget (CLAUDE.md memory discipline).
 */
import {
  PAGE_JPEG_QUALITY,
  encodeViaDomCanvas,
  encodeViaOffscreenCanvas,
  encodeViaWasm,
} from './images'
import type { PageBitmap } from './types'

export type EncoderId = 'offscreen' | 'dom' | 'wasm'

export type Encoder = (bitmap: PageBitmap, quality?: number) => Promise<Blob>

/**
 * Probe image edge, in pixels. Small enough that the whole probe is sub-second
 * on the slowest measured device, large enough that the ~25x spread between
 * candidates dwarfs scheduling noise.
 */
const PROBE_SIZE = 512

const ENCODERS: Record<EncoderId, Encoder> = {
  offscreen: encodeViaOffscreenCanvas,
  dom: encodeViaDomCanvas,
  wasm: encodeViaWasm,
}

function makeProbeBitmap(): PageBitmap {
  const data = new Uint8Array(PROBE_SIZE * PROBE_SIZE * 4)
  for (let y = 0; y < PROBE_SIZE; y += 1) {
    for (let x = 0; x < PROBE_SIZE; x += 1) {
      const i = (y * PROBE_SIZE + x) * 4
      // Text-like blocks: flat colour would compress unrealistically fast.
      const ink = x % 97 < 40 && y % 53 < 20
      data[i] = ink ? 20 : 250 - (x % 6)
      data[i + 1] = ink ? 20 : 248
      data[i + 2] = ink ? 30 : 245
      data[i + 3] = 255
    }
  }
  return { pageIndex: 0, width: PROBE_SIZE, height: PROBE_SIZE, data }
}

async function timeEncoder(
  encode: Encoder,
  bitmap: PageBitmap,
): Promise<number | null> {
  try {
    const startedAt = performance.now()
    await encode(bitmap, PAGE_JPEG_QUALITY)
    return performance.now() - startedAt
  } catch {
    // Unavailable here (no OffscreenCanvas, no DOM, WASM refused to load).
    return null
  }
}

async function measureFastest(): Promise<EncoderId> {
  const bitmap = makeProbeBitmap()
  const ids = Object.keys(ENCODERS) as EncoderId[]

  // Warm EVERY candidate before timing any of them. Each has one-off costs on
  // its first call — WASM instantiation, canvas/Skia setup, JIT — and warming
  // only some hands them the result. Warming just MozJPEG made the probe pick
  // it on desktop, where a full page measures 599ms against canvas's 94ms.
  for (const id of ids) {
    await timeEncoder(ENCODERS[id], bitmap)
  }

  let best: EncoderId = 'wasm'
  let bestMs = Number.POSITIVE_INFINITY
  for (const id of ids) {
    const ms = await timeEncoder(ENCODERS[id], bitmap)
    if (ms !== null && ms < bestMs) {
      bestMs = ms
      best = id
    }
  }
  return best
}

/** Memoized per session — the probe runs at most once per app load. */
let selection: Promise<EncoderId> | null = null

export function selectEncoderId(): Promise<EncoderId> {
  selection ??= measureFastest().catch(
    // A probe that somehow throws must never stop a conversion; MozJPEG is
    // the safe default because it is the only candidate with no catastrophic
    // platform (worst measured 432 ms/page, against canvas's 8500 ms).
    (): EncoderId => 'wasm',
  )
  return selection
}

export async function selectEncoder(): Promise<Encoder> {
  return ENCODERS[await selectEncoderId()]
}

/** Test/diagnostic seam: forget the memoized choice so the probe re-runs. */
export function resetEncoderSelection(): void {
  selection = null
}
