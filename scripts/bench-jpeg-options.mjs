/**
 * TEMPORARY benchmark: MozJPEG/WASM encode options vs the canvas baseline.
 * MozJPEG defaults optimize for file size (trellis quantization, progressive
 * scans), which measured ~56x slower than canvas on desktop. This finds out
 * whether speed-tuned options make it competitive, or whether MozJPEG is the
 * wrong tool for a 200-page batch. Delete once the encoder choice is settled.
 *
 * Start `npx vite` first, then: node scripts/bench-jpeg-options.mjs
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const WIDTH = 1654
const HEIGHT = 2339

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const results = await page.evaluate(
    async ({ width, height }) => {
      const { encode } = await import('/node_modules/@jsquash/jpeg/index.js')

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
      const pixels = new Uint8ClampedArray(data.buffer)
      const image = { data: pixels, width, height, colorSpace: 'srgb' }

      const variants = {
        'mozjpeg defaults': { quality: 80 },
        'no trellis': { quality: 80, trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false },
        'no trellis, baseline': { quality: 80, progressive: false, trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false },
        'fastest': { quality: 80, progressive: false, optimize_coding: false, trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false, auto_subsample: true },
      }

      const out = []

      for (const [name, options] of Object.entries(variants)) {
        let bytes = 0
        const timings = []
        for (let pass = 0; pass < 3; pass += 1) {
          const startedAt = performance.now()
          const buffer = await encode(image, options)
          timings.push(performance.now() - startedAt)
          bytes = buffer.byteLength
        }
        // Drop the first pass (WASM init / warm-up).
        const warm = timings.slice(1)
        out.push({
          name,
          msPerPage: Math.round(warm.reduce((a, b) => a + b, 0) / warm.length),
          kb: Math.round(bytes / 1024),
        })
      }

      // Canvas baseline — what the app does today.
      {
        const timings = []
        let bytes = 0
        for (let pass = 0; pass < 3; pass += 1) {
          const startedAt = performance.now()
          const canvas = new OffscreenCanvas(width, height)
          const context = canvas.getContext('2d')
          context.putImageData(new ImageData(pixels, width, height), 0, 0)
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
          bytes = blob.size
          timings.push(performance.now() - startedAt)
          canvas.width = 0
          canvas.height = 0
        }
        const warm = timings.slice(1)
        out.push({
          name: 'canvas (current)',
          msPerPage: Math.round(warm.reduce((a, b) => a + b, 0) / warm.length),
          kb: Math.round(bytes / 1024),
        })
      }

      return out
    },
    { width: WIDTH, height: HEIGHT },
  )

  console.log(`\n${WIDTH}x${HEIGHT}, warm timings, desktop:\n`)
  for (const r of results) {
    const total = ((r.msPerPage * 200) / 1000).toFixed(0)
    console.log(
      `  ${r.name.padEnd(22)} ${String(r.msPerPage).padStart(6)} ms/page   ${String(r.kb).padStart(5)} KB   → ${total}s for 200 pages`,
    )
  }
  console.log()
} finally {
  await browser.close()
}
