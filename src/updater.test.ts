import { describe, expect, it } from 'vitest'
import { isNewer } from './updater.ts'

describe('isNewer', () => {
  it('detects a higher patch, minor, or major', () => {
    expect(isNewer('0.0.45', '0.0.44')).toBe(true)
    expect(isNewer('0.1.0', '0.0.44')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
  })

  it('is false for equal or older versions', () => {
    expect(isNewer('0.0.44', '0.0.44')).toBe(false)
    expect(isNewer('0.0.43', '0.0.44')).toBe(false)
  })

  it('handles differing segment counts', () => {
    expect(isNewer('0.0.44', '0.0')).toBe(true)
    expect(isNewer('0.0', '0.0.1')).toBe(false)
  })
})
