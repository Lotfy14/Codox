/**
 * Grep the text layer of many PDFs at once, so an exam can be paired with its
 * separate answer key by CONTENT rather than by filename. No Gemini calls.
 *
 *   node scripts/find-in-pdfs.mjs <dir> <regex> [--pages N] [--show]
 *
 * `--pages N` limits how many pages of each document are read (default 6);
 * `--show` prints the matching snippet.
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const [dir, pattern, ...rest] = process.argv.slice(2)
if (!dir || !pattern) {
  console.error('usage: node scripts/find-in-pdfs.mjs <dir> <regex> [--pages N] [--show]')
  process.exit(1)
}
const pagesAt = rest.indexOf('--pages')
const maxPages = pagesAt === -1 ? 6 : Number(rest[pagesAt + 1])
const show = rest.includes('--show')
const re = new RegExp(pattern, 'i')

const files = (await readdir(dir, { withFileTypes: true }))
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
  .map((e) => path.join(dir, e.name))

for (const file of files) {
  try {
    const bytes = new Uint8Array(await readFile(file))
    const pdf = await getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise
    let text = ''
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p += 1) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      text += content.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('')
    }
    const m = text.match(re)
    if (m) {
      console.log(`HIT  ${pdf.numPages}p  ${path.basename(file)}`)
      if (show) {
        const at = text.indexOf(m[0])
        console.log(`     …${text.slice(Math.max(0, at - 120), at + 220).replace(/\s+/g, ' ')}…`)
      }
    }
    await pdf.cleanup()
  } catch {
    /* unreadable document — not a match */
  }
}
