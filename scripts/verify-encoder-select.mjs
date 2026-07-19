/**
 * Runtime check for the encoder probe (src/pdf/encoder-select.ts): that it
 * finishes fast, picks a real encoder, that bitmapToJpeg produces a valid
 * JPEG through whatever it picked, and that the pick agrees with a full-page
 * benchmark of all three candidates.
 *
 * Start `npx vite` first, then: node scripts/verify-encoder-select.mjs
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const PROBE_BUDGET_MS = 3000

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: process.env.BENCH_HEADED !== '1',
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async () => {
    const { selectEncoderId, resetEncoderSelection } = await import(
      '/src/pdf/encoder-select.ts'
    )
    const { bitmapToJpeg } = await import('/src/pdf/images.ts')
    const { benchmarkEncoders } = await import('/src/pdf/encoder-bench.ts')

    // Cold probe, as a real first conversion would hit it.
    resetEncoderSelection()
    const probeStartedAt = performance.now()
    const picked = await selectEncoderId()
    const probeMs = Math.round(performance.now() - probeStartedAt)

    // Memoized: the second call must not re-probe.
    const secondStartedAt = performance.now()
    await selectEncoderId()
    const secondCallMs = Math.round(performance.now() - secondStartedAt)

    // A real page through the public entry point.
    const width = 1654
    const height = 2339
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        const ink = x % 97 < 40 && y % 53 < 20
        data[i] = ink ? 20 : 250 - (x % 6)
        data[i + 1] = ink ? 20 : 248
        data[i + 2] = ink ? 30 : 245
        data[i + 3] = 255
      }
    }
    const blob = await bitmapToJpeg({ pageIndex: 0, width, height, data })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const isJpeg =
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    const decoded = await createImageBitmap(blob)
    const decodedWidth = decoded.width
    const decodedHeight = decoded.height
    decoded.close()

    // Does the cheap probe agree with a full-page measurement?
    const bench = await benchmarkEncoders()
    const measured = bench.filter((r) => r.msPerPage !== null)
    const fastest = measured.reduce((a, b) => (a.msPerPage <= b.msPerPage ? a : b))
    const labels = {
      offscreen: 'OffscreenCanvas (current)',
      dom: 'HTMLCanvasElement',
      wasm: 'MozJPEG / WASM',
    }

    return {
      picked,
      probeMs,
      secondCallMs,
      isJpeg,
      byteLength: bytes.length,
      decodedWidth,
      decodedHeight,
      benchFastest: fastest.name,
      pickedLabel: labels[picked],
      bench: measured.map((r) => `${r.name}: ${r.msPerPage}ms`),
    }
  })

  console.log(JSON.stringify(result, null, 2))

  const failures = []
  if (!['offscreen', 'dom', 'wasm'].includes(result.picked)) {
    failures.push(`probe returned nonsense: ${result.picked}`)
  }
  if (result.probeMs > PROBE_BUDGET_MS) {
    failures.push(`probe took ${result.probeMs}ms, budget ${PROBE_BUDGET_MS}ms`)
  }
  if (result.secondCallMs > 50) {
    failures.push(`second call took ${result.secondCallMs}ms — not memoized`)
  }
  if (!result.isJpeg) failures.push('bitmapToJpeg output is not JPEG-framed')
  if (result.decodedWidth !== 1654 || result.decodedHeight !== 2339) {
    failures.push(
      `decoded ${result.decodedWidth}x${result.decodedHeight}, expected 1654x2339`,
    )
  }
  if (result.pickedLabel !== result.benchFastest) {
    // Not fatal: the probe is small and cheap, so a near-tie can go either
    // way. Loud, because a systematic disagreement means the probe is wrong.
    console.warn(
      `WARN: probe picked ${result.pickedLabel} but full-page fastest was ${result.benchFastest}`,
    )
  }

  if (failures.length > 0) {
    console.error('FAIL: ' + failures.join('; '))
    process.exitCode = 1
  } else {
    console.log(
      `\nPASS: probe chose ${result.pickedLabel} in ${result.probeMs}ms; full-page fastest was ${result.benchFastest}`,
    )
  }
} finally {
  await browser.close()
}
