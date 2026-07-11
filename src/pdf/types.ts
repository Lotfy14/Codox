/**
 * Types shared across the client-side PDF pipeline (Phase 5).
 *
 * Coordinate rule (pinned by CODOX_MIGRATION.md §1.8): every box lives in
 * pixel coordinates on the page image rendered at the fixed reference DPI.
 * Pages are rendered once at that scale; planning, cropping, and review all
 * use those exact images.
 */

/** Raw RGBA pixels for one rendered page, straight from pdfium. */
export interface PageBitmap {
  pageIndex: number
  /** Width in pixels at the render DPI. */
  width: number
  /** Height in pixels at the render DPI. */
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array
}

/** A rectangle in pixels on the rendered page image. */
export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

/** One page after the render → compress step, ready to hand off. */
export interface ProcessedPage {
  pageIndex: number
  pageCount: number
  /** Pixel size of the rendered page the JPEG encodes. */
  width: number
  height: number
  /** Compressed page image — the only pixel data retained per page. */
  jpeg: Blob
  /** pdf.js text layer for this page; empty string for scans. */
  text: string
}

/** A page that failed to render or encode; the job continues without it. */
export interface PageFailure {
  pageIndex: number
  message: string
}
