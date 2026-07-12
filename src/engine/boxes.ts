/**
 * Planner box → pixel crop box (pure). Convention pinned by
 * CODOX_MIGRATION.md §1.8: `[ymin, xmin, ymax, xmax]`, normalized 0–1000,
 * relative to the exact rendered page image the planner saw. y comes
 * FIRST — an x/y swap produces plausible-looking wrong crops.
 */
import type { CropBox } from '../pdf/types'
import type { Box2d } from './types'

/**
 * Maps a 0–1000-normalized planner box onto a rendered page's pixel grid.
 * Pure scaling — clamping to page bounds stays in `clampCropBox`
 * (the only adjustment the cropper is allowed).
 */
export function boxToCropBox(
  box: Box2d,
  pageWidthPx: number,
  pageHeightPx: number,
): CropBox {
  const [ymin, xmin, ymax, xmax] = box
  return {
    x: (xmin / 1000) * pageWidthPx,
    y: (ymin / 1000) * pageHeightPx,
    width: ((xmax - xmin) / 1000) * pageWidthPx,
    height: ((ymax - ymin) / 1000) * pageHeightPx,
  }
}

/** A structurally valid planner box: four finite numbers (§1.6). */
export function isBox2d(value: unknown): value is Box2d {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/**
 * True when the box has positive extent in both axes — the pre-crop
 * degenerate check (§1.3 step 4).
 */
export function hasPositiveExtent(box: Box2d): boolean {
  const [ymin, xmin, ymax, xmax] = box
  return ymax > ymin && xmax > xmin
}
