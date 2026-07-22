import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Box2d } from '../engine/types'
import { db } from '../state/db'
import {
  getFigureCrops,
  moveBox,
  nudgeHandle,
  resizeBox,
  saveFigureCrop,
  MIN_CROP_EXTENT,
  WHOLE_PAGE_BOX,
} from './review-figure-crops'

beforeEach(async () => {
  await db.runArtifacts.clear()
})

describe('saveFigureCrop / getFigureCrops', () => {
  it('stores an override per path and clears it with null', async () => {
    const box: Box2d = [100, 200, 400, 600]
    await saveFigureCrop('run1', 'images/asset01.jpg', box)
    await saveFigureCrop('run1', 'images/asset02.jpg', WHOLE_PAGE_BOX)
    expect(await getFigureCrops('run1')).toEqual({
      'images/asset01.jpg': box,
      'images/asset02.jpg': WHOLE_PAGE_BOX,
    })

    await saveFigureCrop('run1', 'images/asset01.jpg', null)
    expect(await getFigureCrops('run1')).toEqual({
      'images/asset02.jpg': WHOLE_PAGE_BOX,
    })
  })

  it('is empty for a run with no overrides', async () => {
    expect(await getFigureCrops('none')).toEqual({})
  })
})

describe('moveBox', () => {
  it('slides the box and clamps it inside the page', () => {
    expect(moveBox([100, 100, 300, 300], 50, -50)).toEqual([150, 50, 350, 250])
    // Clamped at the top-left edge; size preserved.
    expect(moveBox([100, 100, 300, 300], -500, -500)).toEqual([0, 0, 200, 200])
    // Clamped at the bottom-right edge.
    expect(moveBox([800, 800, 900, 900], 500, 500)).toEqual([900, 900, 1000, 1000])
  })
})

describe('resizeBox', () => {
  it('drags one edge outward to grow the crop', () => {
    // West handle to x=40 grows the left side out (label rescue).
    expect(resizeBox([200, 100, 500, 800], 'w', 0, 40)).toEqual([200, 40, 500, 800])
  })

  it('keeps a minimum extent when an edge crosses its opposite', () => {
    const box: Box2d = [200, 100, 500, 800]
    const [, , , xmax] = resizeBox(box, 'w', 0, 999)
    expect(999 - MIN_CROP_EXTENT).toBeGreaterThan(0)
    // xmin can't pass xmax - MIN_CROP_EXTENT.
    expect(resizeBox(box, 'w', 0, 999)[1]).toBe(xmax - MIN_CROP_EXTENT)
  })

  it('moves both edges for a corner handle', () => {
    expect(resizeBox([200, 100, 500, 800], 'ne', 120, 850)).toEqual([120, 100, 500, 850])
  })
})

describe('nudgeHandle', () => {
  it('grows the pressed side outward', () => {
    // Shift+Left → grow west edge left by the step.
    expect(nudgeHandle([200, 100, 500, 800], 'w', 0, -15)).toEqual([200, 85, 500, 800])
  })

  it('shrinks when the step points inward', () => {
    expect(nudgeHandle([200, 100, 500, 800], 'w', 0, 15)).toEqual([200, 115, 500, 800])
  })

  it("'move' slides the whole box", () => {
    expect(nudgeHandle([200, 100, 500, 800], 'move', 15, 0)).toEqual([215, 100, 515, 800])
  })
})
