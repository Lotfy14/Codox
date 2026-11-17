import { describe, expect, it } from 'vitest'
import { connectUrl, createPairing } from './jobs'

describe('connect link', () => {
  it('puts the secret only in the fragment, never the query', () => {
    const p = createPairing('cards', 1700000000000)
    const url = new URL(connectUrl(p))
    expect(url.pathname).toBe('/codox/connect')
    expect(url.search).toBe('?kind=cards')
    const f = new URLSearchParams(url.hash.slice(1))
    expect(f.get('pair')).toBe(p.pairId)
    expect(f.get('k')).toBe(p.secret)
    expect(f.get('t')).toBe('1700000000000')
    // Same shapes the site accepts (src/lib/codox-jobs.ts in Triviadox).
    expect(p.pairId).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(p.secret).toMatch(/^[A-Za-z0-9_-]{32,128}$/)
  })

  it('makes a new pair and secret every time', () => {
    const a = createPairing('facts')
    const b = createPairing('facts')
    expect(a.pairId).not.toBe(b.pairId)
    expect(a.secret).not.toBe(b.secret)
  })
})
