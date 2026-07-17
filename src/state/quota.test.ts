import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { saveGeminiKey } from './credentials'
import {
  getDailyQuotaUsed,
  recordDailyRequest,
  resetDailyQuota,
} from './quota'

beforeEach(async () => {
  await db.meta.clear()
  await db.credentials.clear()
})

describe('daily quota tally', () => {
  it('counts requests within the same UTC day', async () => {
    await recordDailyRequest()
    await recordDailyRequest()
    await recordDailyRequest()
    expect(await getDailyQuotaUsed()).toBe(3)
  })

  it('a new UTC day starts the tally over', async () => {
    const beforeMidnight = Date.parse('2026-07-17T23:59:00Z')
    const afterMidnight = Date.parse('2026-07-18T00:01:00Z')
    await recordDailyRequest(beforeMidnight)
    await recordDailyRequest(beforeMidnight)
    expect(await getDailyQuotaUsed(beforeMidnight)).toBe(2)

    // Reads from yesterday's row report zero without any write.
    expect(await getDailyQuotaUsed(afterMidnight)).toBe(0)
    await recordDailyRequest(afterMidnight)
    expect(await getDailyQuotaUsed(afterMidnight)).toBe(1)
  })

  it('resetDailyQuota zeroes today', async () => {
    await recordDailyRequest()
    await resetDailyQuota()
    expect(await getDailyQuotaUsed()).toBe(0)
  })

  it('a malformed stored row reads as zero and recovers on the next write', async () => {
    await db.meta.put({ key: 'dailyQuotaUsage', value: 'not json' })
    expect(await getDailyQuotaUsed()).toBe(0)
    await recordDailyRequest()
    expect(await getDailyQuotaUsed()).toBe(1)
  })

  it('replacing the API key resets the tally; re-saving the same key does not', async () => {
    await saveGeminiKey('first-key')
    await recordDailyRequest()
    await recordDailyRequest()
    expect(await getDailyQuotaUsed()).toBe(2)

    await saveGeminiKey('first-key')
    expect(await getDailyQuotaUsed()).toBe(2)

    await saveGeminiKey('second-key')
    expect(await getDailyQuotaUsed()).toBe(0)
  })
})
