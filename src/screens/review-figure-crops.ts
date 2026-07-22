/**
 * Per-figure crop overrides (review). The engine's figure box
 * (`blueprint.assets[].box_2d`) is read-only history; a tutor who finds a
 * linked figure clipped — a label or legend cut off by the model's tight
 * box — adjusts the crop here, and their chosen region is what ships. Like
 * resolutions and edits, overrides live in their own artifact keyed by the
 * bundle crop path and are applied deterministically at export
 * (`applyFigureCropOverrides`), so `merged-rows` and the blueprint stay
 * untouched. NEVER-GUESS is irrelevant here: this reshapes an image crop,
 * never an answer.
 *
 * Boxes are normalized `[ymin, xmin, ymax, xmax]` on the asset's page, the
 * same 0–1000 convention as every planner box.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import type { Box2d } from '../engine/types'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'

/** bundle crop path (e.g. `images/asset01.jpg`) → the tutor's chosen region. */
export type FigureCrops = Readonly<Record<string, Box2d>>

/** The whole page — what the "Show whole page" override stores. */
export const WHOLE_PAGE_BOX: Box2d = [0, 0, 1000, 1000]

/** Smallest crop the editor allows, in normalized units (keeps it usable). */
export const MIN_CROP_EXTENT = 20

export async function getFigureCrops(runId: string): Promise<FigureCrops> {
  const artifact = await getArtifact(runId, 'review-figure-crops')
  return (artifact?.json as Record<string, Box2d> | undefined) ?? {}
}

/** Live view of a run's figure-crop overrides. undefined while loading. */
export function useFigureCrops(runId: string): FigureCrops | undefined {
  return useLiveQuery(() => getFigureCrops(runId), [runId])
}

/** Stores one figure's override box; `null` clears it (back to the auto crop). */
export async function saveFigureCrop(
  runId: string,
  path: string,
  box: Box2d | null,
): Promise<void> {
  const artifact = await getArtifact(runId, 'review-figure-crops')
  const current = (artifact?.json as Record<string, Box2d> | undefined) ?? {}
  const next = { ...current }
  if (box === null) delete next[path]
  else next[path] = box
  if (artifact === undefined) {
    await putArtifact({ runId, kind: 'review-figure-crops', json: next })
    return
  }
  await db.runArtifacts.update(artifact.id, { json: next })
}

// ------------------------------------------------------------ box geometry

/** The eight resize handles plus the whole-box move grip. */
export type CropHandle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'move'

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

/** Slides the whole box by (dy, dx) normalized units, kept inside the page. */
export function moveBox(box: Box2d, dy: number, dx: number): Box2d {
  const [ymin, xmin, ymax, xmax] = box
  const height = ymax - ymin
  const width = xmax - xmin
  const ny = clamp(ymin + dy, 0, 1000 - height)
  const nx = clamp(xmin + dx, 0, 1000 - width)
  return [ny, nx, ny + height, nx + width]
}

/**
 * Drags a handle's edge(s) to the normalized point (py, px), clamped to the
 * page and never letting the box collapse below `MIN_CROP_EXTENT`. A corner
 * handle moves both its edges; an edge handle moves one.
 */
export function resizeBox(
  box: Box2d,
  handle: CropHandle,
  py: number,
  px: number,
): Box2d {
  let [ymin, xmin, ymax, xmax] = box
  const y = clamp(py, 0, 1000)
  const x = clamp(px, 0, 1000)
  if (handle.includes('n')) ymin = Math.min(y, ymax - MIN_CROP_EXTENT)
  if (handle.includes('s')) ymax = Math.max(y, ymin + MIN_CROP_EXTENT)
  if (handle.includes('w')) xmin = Math.min(x, xmax - MIN_CROP_EXTENT)
  if (handle.includes('e')) xmax = Math.max(x, xmin + MIN_CROP_EXTENT)
  return [ymin, xmin, ymax, xmax]
}

/** Nudges a handle by (dy, dx) — the keyboard equivalent of a small drag. */
export function nudgeHandle(
  box: Box2d,
  handle: CropHandle,
  dy: number,
  dx: number,
): Box2d {
  if (handle === 'move') return moveBox(box, dy, dx)
  const [ymin, xmin, ymax, xmax] = box
  // Anchor the moving edges at their current position, then re-drag them.
  const y = handle.includes('n') ? ymin + dy : ymax + dy
  const x = handle.includes('w') ? xmin + dx : xmax + dx
  return resizeBox(box, handle, y, x)
}
