import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { clearEvents, listEvents, logEvent } from './diagnostics'

beforeEach(async () => {
  await db.logs.clear()
})

describe('the on-device diagnostics log', () => {
  it('stores an event and lists it newest first', async () => {
    await logEvent({ t: 1, level: 'info', scope: 'app', event: 'first' })
    await logEvent({ t: 2, level: 'info', scope: 'app', event: 'second' })
    const events = await listEvents()
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('second')
    expect(events[1].event).toBe('first')
  })

  it('holds the ring buffer cap at 500 events', async () => {
    for (let i = 0; i < 510; i++) {
      await logEvent({ t: i, level: 'info', scope: 'app', event: `evt-${i}` })
    }
    expect(await db.logs.count()).toBe(500)
    const events = await listEvents()
    expect(events[0].event).toBe('evt-509')
  })

  it('truncates long detail strings', async () => {
    const long = 'x'.repeat(9000)
    await logEvent({ t: 1, level: 'info', scope: 'app', event: 'big', detail: { blob: long } })
    const events = await listEvents()
    const stored = events[0].detail!.blob as string
    expect(stored.endsWith('…[truncated]')).toBe(true)
    expect(stored.length).toBeLessThan(9000)
  })

  it('clearEvents empties the table', async () => {
    await logEvent({ t: 1, level: 'info', scope: 'app', event: 'one' })
    await logEvent({ t: 2, level: 'info', scope: 'app', event: 'two' })
    await clearEvents()
    expect(await db.logs.count()).toBe(0)
    expect(await listEvents()).toEqual([])
  })

  it('clears only the selected events when seqs are given', async () => {
    await logEvent({ t: 1, level: 'info', scope: 'app', event: 'keep' })
    await logEvent({ t: 2, level: 'info', scope: 'app', event: 'drop' })
    const before = await listEvents()
    const dropSeq = before.find((e) => e.event === 'drop')!.seq!
    await clearEvents([dropSeq])
    const after = await listEvents()
    expect(after).toHaveLength(1)
    expect(after[0].event).toBe('keep')
  })
})