import type { Box2d } from './types'

export function validBox(value: unknown): value is Box2d {
  return Array.isArray(value) && value.length === 4 && value.every((edge) =>
    typeof edge === 'number' && Number.isFinite(edge) && edge >= 0 && edge <= 1000,
  ) && value[2] > value[0] && value[3] > value[1]
}

export function pixelBox(box: Box2d, width: number, height: number, padding = 0) {
  const [top, left, bottom, right] = box
  const paddedTop = Math.max(0, top - padding)
  const paddedLeft = Math.max(0, left - padding)
  const paddedBottom = Math.min(1000, bottom + padding)
  const paddedRight = Math.min(1000, right + padding)
  return {
    x: Math.floor(paddedLeft / 1000 * width),
    y: Math.floor(paddedTop / 1000 * height),
    width: Math.ceil((paddedRight - paddedLeft) / 1000 * width),
    height: Math.ceil((paddedBottom - paddedTop) / 1000 * height),
  }
}
