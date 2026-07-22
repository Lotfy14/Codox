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

/**
 * Figure crops breathe by this many 0–1000 units (~4%) before clamping, to
 * absorb Flash-Lite's measured tight bounding boxes (they clip labels, key
 * legends, and table edges — the "weaker bounding boxes" cost carried in
 * CLAUDE.md). Owner-approved 2026-07-22 as the one adjustment a figure crop
 * is allowed, over §1.3-step-4's "clamping only" pin. Applied identically at
 * crop time (`stepCrops`) and in the review preview so they always match; the
 * degenerate-box gate still runs on the RAW box, so padding never revives a
 * zero-extent asset. It shapes only image assets, not CSV rows — the pinned
 * output contract and gold gate are untouched.
 */
export const FIGURE_BOX_PAD = 40

/** Grows a box by `pad` on every side, clamped to the 0–1000 page. */
export function padBox2d(box: Box2d, pad: number): Box2d {
  const [ymin, xmin, ymax, xmax] = box
  return [
    Math.max(0, ymin - pad),
    Math.max(0, xmin - pad),
    Math.min(1000, ymax + pad),
    Math.min(1000, xmax + pad),
  ]
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
