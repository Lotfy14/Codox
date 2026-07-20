/**
 * Render pages of a source PDF to PNGs so a human (or Claude) can SEE the
 * document before theorising about what the engine did with it. Born from the
 * 2026-07-20 lesson: an INDEX misdiagnosis stood only because the source pages
 * were never looked at — the model's output was reasoned about in a vacuum.
 *
 * Usage:  node scripts/render-pdf-pages.mjs <file.pdf> <page> [page...]
 * Pages are 1-based. PNGs land in scripts/out/ (gitignored) as page-N.png.
 *
 * Uses the same @hyzyla/pdfium the app renders with, so what you see is what
 * the engine saw. No Gemini calls.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'

const [file, ...pageArgs] = process.argv.slice(2)
if (file === undefined || pageArgs.length === 0) {
  console.error('usage: node scripts/render-pdf-pages.mjs <file.pdf> <page> [page...]')
  process.exit(1)
}

const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
await mkdir(OUT, { recursive: true })

const bytes = await readFile(file)
const library = await PDFiumLibrary.init()
const doc = await library.loadDocument(new Uint8Array(bytes))
console.log('pages in document:', doc.getPageCount())

for (const n of pageArgs.map(Number)) {
  const page = doc.getPage(n - 1)
  const rendered = await page.render({
    scale: 2,
    render: ({ data, width, height }) =>
      sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer(),
  })
  await writeFile(`${OUT}page-${n}.png`, rendered.data)
  console.log('wrote', `page-${n}.png`)
}

doc.destroy()
library.destroy()
