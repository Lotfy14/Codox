/**
 * Bitmap → JPEG compression and deterministic cropping.
 *
 * Image budget (CLAUDE.md memory discipline): the compressed JPEG is the
 * only per-page pixel artifact retained; raw RGBA buffers and canvases
 * are released immediately after use. Canvases get their dimensions
 * zeroed in `finally` so the backing store is freed without waiting for
 * garbage collection.
 */
import { encode as encodeJpeg } from '@jsquash/jpeg'
import type { CropBox, PageBitmap } from './types'

export const PAGE_JPEG_QUALITY = 0.8
export const CROP_JPEG_QUALITY = 0.85

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Any2dContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function get2dContext(canvas: AnyCanvas): Any2dContext {
  const context = canvas.getContext('2d') as Any2dContext | null
  if (context === null) throw new Error('Could not create a 2d canvas context')
  return context
}

function releaseCanvas(canvas: AnyCanvas): void {
  canvas.width = 0
  canvas.height = 0
}

async function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob !== null
          ? resolve(blob)
          : reject(new Error('JPEG encoding failed')),
      'image/jpeg',
      quality,
    )
  })
}

/** Canvas quality is 0–1; MozJPEG wants 0–100. */
function toMozjpegQuality(quality: number): number {
  return Math.round(quality * 100)
}

/** A view over the RGBA buffer — no copy of the ~15 MB page bitmap. */
function pixelView(bitmap: PageBitmap): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(
    bitmap.data.buffer,
    bitmap.data.byteOffset,
    bitmap.data.byteLength,
  ) as Uint8ClampedArray<ArrayBuffer>
}

/**
 * The original canvas encode path, kept only as a fallback for a device
 * where the MozJPEG WASM fails to instantiate. Measured at ~40x slower than
 * the WASM encoder inside Capacitor's Android WebView (2026-07-19), so it is
 * a correctness net, never the fast path.
 */
async function bitmapToJpegViaCanvas(
  bitmap: PageBitmap,
  quality: number,
): Promise<Blob> {
  const canvas = makeCanvas(bitmap.width, bitmap.height)
  try {
    const context = get2dContext(canvas)
    const pixels = pixelView(bitmap)
    context.putImageData(new ImageData(pixels, bitmap.width, bitmap.height), 0, 0)
    return await canvasToJpeg(canvas, quality)
  } finally {
    releaseCanvas(canvas)
  }
}

/**
 * Compress one rendered page to the per-page JPEG budget.
 *
 * MozJPEG-in-WASM consumes pdfium's RGBA buffer directly. The canvas route
 * this replaced was ~40x slower in the Android WebView than in Chrome on the
 * same phone — Skia's bitmap/readback path, not the JPEG maths — so keeping
 * pixels out of a canvas makes encoding cost the same on every platform.
 */
export async function bitmapToJpeg(
  bitmap: PageBitmap,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  return bitmapToJpegViaCanvas(bitmap, quality)
}

/**
 * MozJPEG-in-WASM, kept for the on-device encoder benchmark. Measured on
 * desktop at 502 ms/page (baseline options) against canvas's 194 ms/page, so
 * it is NOT a general replacement — but it never touches Skia, which may make
 * it the faster route inside Capacitor's WebView. Not wired into the pipeline
 * until device numbers say it should be.
 */
export async function bitmapToJpegViaWasm(
  bitmap: PageBitmap,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  const encoded = await encodeJpeg(
    {
      data: pixelView(bitmap),
      width: bitmap.width,
      height: bitmap.height,
      colorSpace: 'srgb',
    },
    {
      quality: toMozjpegQuality(quality),
      // Trellis + progressive are the expensive parts and buy ~10% size.
      progressive: false,
      trellis_multipass: false,
      trellis_opt_zero: false,
      trellis_opt_table: false,
    },
  )
  return new Blob([encoded], { type: 'image/jpeg' })
}

/**
 * Clamp a crop box to the page's pixel bounds. Returns null when nothing
 * of the box lies on the page. Clamping is the only adjustment allowed —
 * the cropper never reinterprets planner boxes (CODOX_MIGRATION §1.8).
 */
export function clampCropBox(
  box: CropBox,
  pageWidth: number,
  pageHeight: number,
): CropBox | null {
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  const right = Math.min(pageWidth, Math.ceil(box.x + box.width))
  const bottom = Math.min(pageHeight, Math.ceil(box.y + box.height))
  const width = right - x
  const height = bottom - y
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * Cut a figure crop out of an already-compressed page JPEG. The box is in
 * pixels on that rendered page image — the same image the planner saw.
 */
export async function cropJpeg(
  pageJpeg: Blob,
  box: CropBox,
  quality: number = CROP_JPEG_QUALITY,
): Promise<Blob> {
  const source = await createImageBitmap(pageJpeg)
  try {
    const clamped = clampCropBox(box, source.width, source.height)
    if (clamped === null) {
      throw new Error('Crop box lies entirely outside the page')
    }
    const canvas = makeCanvas(clamped.width, clamped.height)
    try {
      const context = get2dContext(canvas)
      context.drawImage(
        source,
        clamped.x,
        clamped.y,
        clamped.width,
        clamped.height,
        0,
        0,
        clamped.width,
        clamped.height,
      )
      return await canvasToJpeg(canvas, quality)
    } finally {
      releaseCanvas(canvas)
    }
  } finally {
    source.close()
  }
}
