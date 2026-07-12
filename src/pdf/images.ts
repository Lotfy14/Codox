/**
 * Bitmap → JPEG compression and deterministic cropping.
 *
 * Image budget (CLAUDE.md memory discipline): the compressed JPEG is the
 * only per-page pixel artifact retained; raw RGBA buffers and canvases
 * are released immediately after use. Canvases get their dimensions
 * zeroed in `finally` so the backing store is freed without waiting for
 * garbage collection.
 */
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

/** Compress one rendered page to the per-page JPEG budget. */
export async function bitmapToJpeg(
  bitmap: PageBitmap,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  const canvas = makeCanvas(bitmap.width, bitmap.height)
  try {
    const context = get2dContext(canvas)
    // A view over the RGBA buffer — no copy of the ~35 MB page bitmap.
    const pixels = new Uint8ClampedArray(
      bitmap.data.buffer,
      bitmap.data.byteOffset,
      bitmap.data.byteLength,
    ) as Uint8ClampedArray<ArrayBuffer>
    context.putImageData(new ImageData(pixels, bitmap.width, bitmap.height), 0, 0)
    return await canvasToJpeg(canvas, quality)
  } finally {
    releaseCanvas(canvas)
  }
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
