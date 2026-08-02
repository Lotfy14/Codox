import { describe, expect, it } from 'vitest'
import { mapConcurrent } from './concurrency'

/** A promise the test resolves by hand, to control completion order. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('mapConcurrent', () => {
  it('returns results in item order even when completion order differs', async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const pending = mapConcurrent([0, 1, 2], 3, async (item) => {
      await gates[item].promise
      return `item-${item}`
    })
    // Resolve in reverse order.
    gates[2].resolve()
    gates[1].resolve()
    gates[0].resolve()
    expect(await pending).toEqual(['item-0', 'item-1', 'item-2'])
  })

  it('never runs more than the limit at once', async () => {
    let active = 0
    let peak = 0
    const result = await mapConcurrent(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async (item) => {
        active += 1
        peak = Math.max(peak, active)
        await tick()
        active -= 1
        return item * 2
      },
    )
    expect(peak).toBeLessThanOrEqual(3)
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
  })

  it('stops launching new items after a failure and rethrows the first error', async () => {
    const started: number[] = []
    const boom = new Error('boom')
    await expect(
      mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item)
        await tick()
        if (item === 1) throw boom
        return item
      }),
    ).rejects.toBe(boom)
    // Items 0 and 1 start immediately; item 2 may start on runner 0's next
    // loop before item 1 fails, but nothing beyond that is launched.
    expect(started.length).toBeLessThanOrEqual(3)
  })

  it('lets in-flight items settle before rethrowing', async () => {
    const slow = deferred<void>()
    let slowFinished = false
    const pending = mapConcurrent([0, 1], 2, async (item) => {
      if (item === 0) {
        await slow.promise
        slowFinished = true
        return item
      }
      throw new Error('fast failure')
    })
    await tick()
    slow.resolve()
    await expect(pending).rejects.toThrow('fast failure')
    expect(slowFinished).toBe(true)
  })

  it('handles an empty list', async () => {
    expect(await mapConcurrent([], 4, async (item) => item)).toEqual([])
  })

  it('a limit larger than the list just runs everything', async () => {
    expect(await mapConcurrent([1, 2], 8, async (item) => item + 1)).toEqual([
      2, 3,
    ])
  })
})
