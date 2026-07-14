/**
 * Runtime check for the pdf.js worker rewire (Promise.try polyfill wrapper).
 * Drives the real app origin at http://localhost:5173 (start `npx vite` first)
 * with playwright-core + installed Edge, dynamically imports the actual
 * textLayer module, and confirms text extraction works through the rewired
 * worker. Also asserts the run does NOT hang (a regression would time out).
 */
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ??
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async () => {
    // A tiny one-page PDF that carries a real text layer.
    function textPdf(label) {
      const content = `BT /F1 18 Tf 72 720 Td (${label}) Tj ET`
      const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
        '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
      ]
      let pdf = '%PDF-1.4\n'
      const offsets = [0]
      for (const object of objects) {
        offsets.push(pdf.length)
        pdf += object
      }
      const xref = pdf.length
      pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
      for (let i = 1; i <= objects.length; i++) {
        pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
      }
      pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
      return new Uint8Array([...pdf].map((c) => c.charCodeAt(0)))
    }

    const mod = await import('/src/pdf/textLayer.ts')
    const bytes = textPdf('CODOX_WORKER_OK')
    const started = performance.now()
    const texts = await mod.extractTextLayers(bytes)
    return { texts, ms: Math.round(performance.now() - started) }
  })

  const joined = (result.texts ?? []).join(' ')
  const pass = joined.includes('CODOX_WORKER_OK')
  console.log('extracted:', JSON.stringify(result.texts), `(${result.ms}ms)`)
  console.log(pass ? 'PASS: worker loaded and text extracted' : 'FAIL: expected text not found')
  process.exitCode = pass ? 0 : 1
} catch (error) {
  console.log('FAIL:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await browser.close()
}
