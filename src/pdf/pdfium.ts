/**
 * pdfium rendering with the mobile memory discipline baked in
 * (CLAUDE.md): pages render one at a time, the raw bitmap is handed off
 * and released before the next page, and the WASM library is destroyed
 * and re-initialized every few pages as a native-heap safety net.
 */
import { PDFiumLibrary } from '@hyzyla/pdfium'
import pdfiumWasmUrl from '@hyzyla/pdfium/pdfium.wasm?url'
import type { PageBitmap, PageFailure } from './types'
import type { StageTimer } from './timing'

/** Pinned reference render DPI (CODOX_MIGRATION.md parameters table). */
export const RENDER_DPI = 200

/** PDF user-space units are points, 72 per inch. */
const PDF_POINTS_PER_INCH = 72

/** Destroy + re-init the WASM library after this many pages. */
export const REINIT_EVERY_PAGES = 8

export function scaleForDpi(dpi: number): number {
  return dpi / PDF_POINTS_PER_INCH
}

/** The PDF is password-protected; Codox never asks for PDF passwords. */
export class EncryptedPdfError extends Error {
  constructor(fileName?: string) {
    super(`PDF is password-protected${fileName ? `: ${fileName}` : ''}`)
    this.name = 'EncryptedPdfError'
  }
}

/** The bytes are not a readable PDF (wrong format or corrupted). */
export class NotAPdfError extends Error {
  constructor(fileName?: string) {
    super(`Not a readable PDF${fileName ? `: ${fileName}` : ''}`)
    this.name = 'NotAPdfError'
  }
}

/** pdfium throws plain Errors with fixed messages; map the two we act on. */
function mapLoadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Password required')) return new EncryptedPdfError()
  if (message.includes('not in PDF format')) return new NotAPdfError()
  return error instanceof Error ? error : new Error(message)
}

async function openSession(bytes: Uint8Array) {
  const library = await PDFiumLibrary.init({ wasmUrl: pdfiumWasmUrl })
  try {
    // loadDocument copies the bytes into the WASM heap, so the same
    // Uint8Array stays valid for reloads after a re-init.
    const document = await library.loadDocument(bytes)
    return { library, document }
  } catch (error) {
    library.destroy()
    throw mapLoadError(error)
  }
}

type Session = Awaited<ReturnType<typeof openSession>>

function closeSession(session: Session): void {
  session.document.destroy()
  session.library.destroy()
}

/** Open, count pages, close. The Upload screen's intake check. */
export async function readPdfInfo(
  bytes: Uint8Array,
): Promise<{ pageCount: number }> {
  const session = await openSession(bytes)
  try {
    return { pageCount: session.document.getPageCount() }
  } finally {
    closeSession(session)
  }
}

export interface RenderPagesOptions {
  dpi?: number
  reinitEvery?: number
  signal?: AbortSignal
  /** DIAGNOSTIC: accumulates per-stage timings when supplied. */
  timer?: StageTimer
}

export interface RenderPagesResult {
  pageCount: number
  /** Pages that failed to render; the loop continued past them. */
  failures: PageFailure[]
}

/**
 * Render every page at the fixed scale, one at a time. `onPage` receives
 * the raw RGBA bitmap and must copy/compress what it needs before
 * returning — the bitmap is not retained. A page that fails to render is
 * recorded and skipped; only an abort stops the loop early.
 */
export async function forEachRenderedPage(
  bytes: Uint8Array,
  onPage: (page: PageBitmap, pageCount: number) => void | Promise<void>,
  options: RenderPagesOptions = {},
): Promise<RenderPagesResult> {
  const scale = scaleForDpi(options.dpi ?? RENDER_DPI)
  const reinitEvery = Math.max(1, options.reinitEvery ?? REINIT_EVERY_PAGES)
  const failures: PageFailure[] = []
  const timer = options.timer
  // DIAGNOSTIC: `init` isolates the WASM instantiation + document parse that
  // each re-init pays, `render` the pdfium raster itself.
  const open = () =>
    timer === undefined
      ? openSession(bytes)
      : timer.time('init', () => openSession(bytes))

  let session = await open()
  try {
    const pageCount = session.document.getPageCount()
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      options.signal?.throwIfAborted()

      if (pageIndex > 0 && pageIndex % reinitEvery === 0) {
        closeSession(session)
        session = await open()
      }

      let rendered: Awaited<
        ReturnType<ReturnType<Session['document']['getPage']>['render']>
      >
      try {
        const page = session.document.getPage(pageIndex)
        const draw = () => page.render({ scale, render: 'bitmap' })
        rendered =
          timer === undefined ? await draw() : await timer.time('render', draw)
      } catch (error) {
        // One bad page never crashes a job — flag it and continue.
        failures.push({
          pageIndex,
          message: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      await onPage(
        {
          pageIndex,
          width: rendered.width,
          height: rendered.height,
          data: rendered.data,
        },
        pageCount,
      )
    }
    return { pageCount, failures }
  } finally {
    closeSession(session)
  }
}

/** Render one page (spike surface, later Review display). */
export async function renderSinglePage(
  bytes: Uint8Array,
  pageIndex: number,
  dpi: number = RENDER_DPI,
): Promise<PageBitmap> {
  const session = await openSession(bytes)
  try {
    const page = session.document.getPage(pageIndex)
    const rendered = await page.render({
      scale: scaleForDpi(dpi),
      render: 'bitmap',
    })
    return {
      pageIndex,
      width: rendered.width,
      height: rendered.height,
      data: rendered.data,
    }
  } finally {
    closeSession(session)
  }
}
