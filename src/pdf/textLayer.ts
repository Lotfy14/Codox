/**
 * pdf.js text-layer extraction — the words specialty, alongside pdfium's
 * pixels specialty (TECHSTACK_RESEARCH.md). The extracted text is a hint
 * for born-digital PDFs, passed alongside the page image; Gemini reads
 * the images, and the text never replaces them.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
// A polyfilling wrapper around pdf.js's real worker — see pdfjsWorker.ts.
import pdfjsWorkerUrl from './pdfjsWorker?worker&url'

GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/**
 * A crashed or genuinely stuck pdf.js worker must never freeze the run. The
 * text layer is only a hint — Gemini reads the page images regardless — so if
 * extraction has not finished within this budget we abandon it and return no
 * text rather than hang the render step at 0%.
 */
const TEXT_LAYER_TIMEOUT_MS = 30_000

/**
 * One string per page; empty string when the page has no text layer
 * (normal for scans). A PDF that pdf.js cannot parse yields all-empty
 * text rather than an error — pdfium may still render it fine.
 */
export async function extractTextLayers(bytes: Uint8Array): Promise<string[]> {
  // pdf.js transfers the buffer to its worker — hand it a copy so the
  // caller's bytes stay usable for pdfium.
  const task = getDocument({ data: bytes.slice() })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), TEXT_LAYER_TIMEOUT_MS)
  })
  const extraction = (async () => {
    const document = await task.promise
    const texts: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str
          text += item.hasEOL ? '\n' : ' '
        }
      }
      texts.push(text.replace(/[ \t]+/g, ' ').trim())
      page.cleanup()
    }
    return texts
  })()
  try {
    // Whichever settles first: a clean extraction, or the timeout's empty
    // result. A dead worker leaves `extraction` pending forever — the
    // timeout is what unblocks the render step.
    return await Promise.race([extraction, timeout])
  } catch {
    return []
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await task.destroy()
  }
}
