/**
 * The page-at-a-time pipeline: render → compress → hand off → release.
 * This is the function the Phase-6 engine executor will drive; in Phase 5
 * the spike surface drives it for the memory stress test.
 */
import { bitmapToJpeg } from './images'
import { forEachRenderedPage, type RenderPagesOptions } from './pdfium'
import { extractTextLayers } from './textLayer'
import type { PageFailure, ProcessedPage } from './types'

export type ProcessPdfOptions = RenderPagesOptions

export interface ProcessPdfResult {
  pageCount: number
  /** Pages that failed to render or encode; the job continued past them. */
  failures: PageFailure[]
}

/**
 * Process every page of a PDF, one at a time. `onPage` receives the
 * compressed page (JPEG + text-layer hint) and should move it along
 * (store, send) before returning; the raw bitmap is already released by
 * then. A failing page is recorded and skipped — one bad page never
 * crashes a job. Only an abort stops the loop.
 */
export async function processPdf(
  bytes: Uint8Array,
  onPage: (page: ProcessedPage) => void | Promise<void>,
  options: ProcessPdfOptions = {},
): Promise<ProcessPdfResult> {
  // Text layers first: a cheap whole-document pass (no rendering).
  const texts = await extractTextLayers(bytes)

  const encodeFailures: PageFailure[] = []
  const { pageCount, failures } = await forEachRenderedPage(
    bytes,
    async (bitmap, pageCount) => {
      let jpeg: Blob
      try {
        jpeg = await bitmapToJpeg(bitmap)
      } catch (error) {
        encodeFailures.push({
          pageIndex: bitmap.pageIndex,
          message: error instanceof Error ? error.message : String(error),
        })
        return
      }
      await onPage({
        pageIndex: bitmap.pageIndex,
        pageCount,
        width: bitmap.width,
        height: bitmap.height,
        jpeg,
        text: texts[bitmap.pageIndex] ?? '',
      })
    },
    options,
  )

  return { pageCount, failures: [...failures, ...encodeFailures] }
}
