import { describe, expect, it } from 'vitest'
import { boxToCropBox, hasPositiveExtent, isBox2d } from './boxes'

describe('boxToCropBox', () => {
  it('maps [ymin, xmin, ymax, xmax] onto an asymmetric page — y first', () => {
    // Page 1000×2000 px: any x/y swap changes the numbers loudly.
    const crop = boxToCropBox([100, 200, 300, 400] as const, 1000, 2000)
    expect(crop).toEqual({
      x: 200, // xmin/1000 × width
      y: 200, // ymin/1000 × height (2000 px tall!)
      width: 200, // (xmax−xmin)/1000 × width
      height: 400, // (ymax−ymin)/1000 × height
    })
  })

  it('the full-page box covers the whole page exactly', () => {
    expect(boxToCropBox([0, 0, 1000, 1000] as const, 1654, 2339)).toEqual({
      x: 0,
      y: 0,
      width: 1654,
      height: 2339,
    })
  })

  it('keeps fractional pixels for clampCropBox to round', () => {
    const crop = boxToCropBox([1, 1, 999, 999] as const, 1001, 1001)
    expect(crop.x).toBeCloseTo(1.001)
    expect(crop.y).toBeCloseTo(1.001)
  })
})

describe('isBox2d', () => {
  it('accepts a numeric 4-array', () => {
    expect(isBox2d([0, 0, 100, 100])).toBe(true)
  })
  it('rejects wrong lengths, strings, NaN, and non-arrays', () => {
    expect(isBox2d([0, 0, 100])).toBe(false)
    expect(isBox2d([0, 0, 100, '100'])).toBe(false)
    expect(isBox2d([0, 0, 100, Number.NaN])).toBe(false)
    expect(isBox2d({ ymin: 0 })).toBe(false)
    expect(isBox2d(null)).toBe(false)
  })
})

describe('hasPositiveExtent', () => {
  it('accepts a real box and rejects degenerate ones', () => {
    expect(hasPositiveExtent([0, 0, 100, 100] as const)).toBe(true)
    expect(hasPositiveExtent([100, 0, 100, 50] as const)).toBe(false) // zero height
    expect(hasPositiveExtent([0, 50, 100, 50] as const)).toBe(false) // zero width
    expect(hasPositiveExtent([300, 400, 100, 200] as const)).toBe(false) // inverted
  })
})
