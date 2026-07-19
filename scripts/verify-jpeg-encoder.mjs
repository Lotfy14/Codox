/**
 * Runtime check for the MozJPEG-in-WASM encode path (src/pdf/images.ts).
 * Drives the real app origin at http://localhost:5173 (start `npx vite` first)
 * with playwright-core + installed Edge, dynamically imports the actual
 * images module, and encodes a realistic full-page RGBA bitmap.
 *
 * The point of this script is the fallback check: bitmapToJpeg catches a
 * failed WASM encode and quietly falls back to the old canvas path, so a
 * broken WASM load would still "work" while staying exactly as slow. Both
 * canvas encode entry points are sabotaged before the call, so a success
 * here proves the WASM encoder — and only the WASM encoder — produced the
 * JPEG.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

// A4 at the pinned 200 DPI — the real per-page shape.
const WIDTH = 1654
const HEIGHT = 2339

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(
    async ({ width, height }) => {
      // Sabotage BOTH canvas encode paths. If the WASM encoder is not doing
      // the work, bitmapToJpeg's fallback lands here and the call fails
      // instead of silently returning a slow-but-valid JPEG.
      let canvasFallbackUsed = false
      const sabotage = () => {
        canvasFallbackUsed = true
        throw new Error('canvas encode path used — WASM encoder did not run')
      }
      if (typeof OffscreenCanvas !== 'undefined') {
        OffscreenCanvas.prototype.convertToBlob = sabotage
      }
      HTMLCanvasElement.prototype.toBlob = sabotage

      const { bitmapToJpeg } = await import('/src/pdf/images.ts')

      // Gradient + block content: compresses like a page, not like flat colour.
      const data = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4
          const ink = x % 97 < 40 && y % 53 < 20 ? 0 : 255
          data[i] = ink === 0 ? 20 : 250 - (x % 6)
          data[i + 1] = ink === 0 ? 20 : 248
          data[i + 2] = ink === 0 ? 30 : 245
          data[i + 3] = 255
        }
      }

      // The first call pays WASM instantiation; a 200-page run pays it once.
      // Steady-state per-page cost is what actually decides this fix, so time
      // several encodes and report them separately.
      const timings = []
      let blob
      for (let pass = 0; pass < 4; pass += 1) {
        const startedAt = performance.now()
        try {
          blob = await bitmapToJpeg({ pageIndex: 0, width, height, data })
        } catch (error) {
          return {
            ok: false,
            canvasFallbackUsed,
            error: error instanceof Error ? error.message : String(error),
          }
        }
        timings.push(Math.round(performance.now() - startedAt))
      }
      const encodeMs = timings[0]
      const steadyStateMs = Math.round(
        timings.slice(1).reduce((a, b) => a + b, 0) / (timings.length - 1),
      )

      const bytes = new Uint8Array(await blob.arrayBuffer())
      const isJpeg =
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9

      // Decode it back: proves the bytes are a real, readable image at the
      // right dimensions, not just something with JPEG markers on the ends.
      let decodedWidth = 0
      let decodedHeight = 0
      try {
        const decoded = await createImageBitmap(blob)
        decodedWidth = decoded.width
        decodedHeight = decoded.height
        decoded.close()
      } catch (error) {
        return {
          ok: false,
          canvasFallbackUsed,
          error: `decode failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      return {
        ok: true,
        canvasFallbackUsed,
        type: blob.type,
        byteLength: bytes.length,
        isJpeg,
        decodedWidth,
        decodedHeight,
        firstEncodeMs: encodeMs,
        steadyStateMs,
        allTimingsMs: timings,
      }
    },
    { width: WIDTH, height: HEIGHT },
  )

  console.log(JSON.stringify(result, null, 2))

  const failures = []
  if (!result.ok) failures.push(result.error)
  if (result.canvasFallbackUsed) failures.push('canvas fallback was used')
  if (result.ok) {
    if (!result.isJpeg) failures.push('output is not JPEG-framed')
    if (result.type !== 'image/jpeg') failures.push(`bad blob type ${result.type}`)
    if (result.decodedWidth !== WIDTH || result.decodedHeight !== HEIGHT) {
      failures.push(
        `decoded ${result.decodedWidth}x${result.decodedHeight}, expected ${WIDTH}x${HEIGHT}`,
      )
    }
    // A blank/degenerate encode would be a few hundred bytes.
    if (result.byteLength < 20_000) {
      failures.push(`suspiciously small output: ${result.byteLength} bytes`)
    }
  }

  if (failures.length > 0) {
    console.error('FAIL: ' + failures.join('; '))
    process.exitCode = 1
  } else {
    console.log(
      `PASS: MozJPEG/WASM encoded ${WIDTH}x${HEIGHT} to ${result.byteLength} bytes, ` +
        `no canvas involved. First encode ${result.firstEncodeMs}ms (includes WASM init), ` +
        `steady state ${result.steadyStateMs}ms/page.`,
    )
  }
} finally {
  await browser.close()
}
