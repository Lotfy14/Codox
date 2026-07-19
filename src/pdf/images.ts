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

/** Paint the RGBA buffer into an already-sized canvas. */
function paint(canvas: AnyCanvas, bitmap: PageBitmap): void {
  const context = get2dContext(canvas)
  context.putImageData(
    new ImageData(pixelView(bitmap), bitmap.width, bitmap.height),
    0,
    0,
  )
}

/**
 * Encode through an OffscreenCanvas. Fastest on the Windows app (83 ms/page)
 * and ruinous inside Capacitor's Android WebView (8500 ms/page) — which is why
 * no single canvas path can be hard-coded. See encoder-select.ts.
 */
export async function encodeViaOffscreenCanvas(
  bitmap: PageBitmap,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  try {
    paint(canvas, bitmap)
    return await canvasToJpeg(canvas, quality)
  } finally {
    releaseCanvas(canvas)
  }
}

/** Encode through a DOM canvas. Fastest on desktop web (95 ms/page). */
export async function encodeViaDomCanvas(
  bitmap: PageBitmap,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  try {
    paint(canvas, bitmap)
    return await canvasToJpeg(canvas, quality)
  } finally {
    releaseCanvas(canvas)
  }
}

/**
 * MozJPEG-in-WASM: consumes pdfium's RGBA directly, never touching Skia.
 * Measured at a boringly consistent 331-432 ms/page across three shells and
 * two CPUs — the slowest option where canvas works, and 26x the fastest where
 * it does not (the Android WebView).
 */
export async function encodeViaWasm(
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
 * Compress one rendered page to the per-page JPEG budget, through whichever
 * encoder measured fastest on this device (see encoder-select.ts).
 */
export async function bitmapToJpeg(
  bitmap: PageBitmap,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  const { selectEncoder } = await import('./encoder-select')
  const encode = await selectEncoder()
  return encode(bitmap, quality)
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
