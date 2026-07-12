/**
 * pdf.js text-layer extraction — the words specialty, alongside pdfium's
 * pixels specialty (TECHSTACK_RESEARCH.md). The extracted text is a hint
 * for born-digital PDFs, passed alongside the page image; Gemini reads
 * the images, and the text never replaces them.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/**
 * One string per page; empty string when the page has no text layer
 * (normal for scans). A PDF that pdf.js cannot parse yields all-empty
 * text rather than an error — pdfium may still render it fine.
 */
export async function extractTextLayers(bytes: Uint8Array): Promise<string[]> {
  // pdf.js transfers the buffer to its worker — hand it a copy so the
  // caller's bytes stay usable for pdfium.
  const task = getDocument({ data: bytes.slice() })
  try {
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
  } catch {
    return []
  } finally {
    await task.destroy()
  }
}
