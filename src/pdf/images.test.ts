import { describe, expect, it } from 'vitest'
import { clampCropBox } from './images'

describe('clampCropBox', () => {
  it('passes a box fully inside the page through (integer-aligned)', () => {
    expect(clampCropBox({ x: 10, y: 20, width: 100, height: 50 }, 800, 600)).toEqual(
      { x: 10, y: 20, width: 100, height: 50 },
    )
  })

  it('expands fractional edges outward to whole pixels', () => {
    expect(
      clampCropBox({ x: 10.6, y: 20.2, width: 99.6, height: 49.9 }, 800, 600),
    ).toEqual({ x: 10, y: 20, width: 101, height: 51 })
  })

  it('clamps a box overhanging the right/bottom edges', () => {
    expect(
      clampCropBox({ x: 750, y: 580, width: 100, height: 100 }, 800, 600),
    ).toEqual({ x: 750, y: 580, width: 50, height: 20 })
  })

  it('clamps negative origins to the page', () => {
    expect(clampCropBox({ x: -30, y: -10, width: 100, height: 50 }, 800, 600)).toEqual(
      { x: 0, y: 0, width: 70, height: 40 },
    )
  })

  it('returns null when the box lies entirely outside the page', () => {
    expect(clampCropBox({ x: 900, y: 0, width: 50, height: 50 }, 800, 600)).toBeNull()
    expect(clampCropBox({ x: 0, y: -80, width: 50, height: 50 }, 800, 600)).toBeNull()
  })

  it('returns null for a zero-area box — never a guessed crop', () => {
    expect(clampCropBox({ x: 10, y: 10, width: 0, height: 50 }, 800, 600)).toBeNull()
  })
})
