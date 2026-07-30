import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { saveGeminiKey } from './credentials'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  FALLBACK_GEMINI_VISION_MODEL,
} from '../providers/gemini'
import {
  getDailyQuotaUsed,
  recordDailyRequest,
  resetDailyQuota,
} from './quota'

const NEWER = DEFAULT_GEMINI_VISION_MODEL
const OLDER = FALLBACK_GEMINI_VISION_MODEL

beforeEach(async () => {
  await db.meta.clear()
  await db.credentials.clear()
})

describe('daily quota tally', () => {
  it('counts requests within the same UTC day', async () => {
    await recordDailyRequest(NEWER)
    await recordDailyRequest(NEWER)
    await recordDailyRequest(NEWER)
    expect(await getDailyQuotaUsed(NEWER)).toBe(3)
  })

  it('tallies each model separately — the free-tier allowance is per model', async () => {
    await recordDailyRequest(NEWER)
    await recordDailyRequest(NEWER)
    await recordDailyRequest(OLDER)

    expect(await getDailyQuotaUsed(NEWER)).toBe(2)
    expect(await getDailyQuotaUsed(OLDER)).toBe(1)
  })

  it('a model with no requests today reads zero, not the other model’s count', async () => {
    await recordDailyRequest(NEWER)
    expect(await getDailyQuotaUsed(OLDER)).toBe(0)
  })

  it('a new UTC day starts the tally over', async () => {
    const beforeMidnight = Date.parse('2026-07-17T23:59:00Z')
    const afterMidnight = Date.parse('2026-07-18T00:01:00Z')
    await recordDailyRequest(NEWER, beforeMidnight)
    await recordDailyRequest(NEWER, beforeMidnight)
    expect(await getDailyQuotaUsed(NEWER, beforeMidnight)).toBe(2)

    // Reads from yesterday's row report zero without any write.
    expect(await getDailyQuotaUsed(NEWER, afterMidnight)).toBe(0)
    await recordDailyRequest(NEWER, afterMidnight)
    expect(await getDailyQuotaUsed(NEWER, afterMidnight)).toBe(1)
  })

  it('a new UTC day clears every model, not just the one being written', async () => {
    const beforeMidnight = Date.parse('2026-07-17T23:59:00Z')
    const afterMidnight = Date.parse('2026-07-18T00:01:00Z')
    await recordDailyRequest(OLDER, beforeMidnight)
    await recordDailyRequest(NEWER, afterMidnight)

    expect(await getDailyQuotaUsed(NEWER, afterMidnight)).toBe(1)
    expect(await getDailyQuotaUsed(OLDER, afterMidnight)).toBe(0)
  })

  it('resetDailyQuota zeroes today for every model', async () => {
    await recordDailyRequest(NEWER)
    await recordDailyRequest(OLDER)
    await resetDailyQuota()
    expect(await getDailyQuotaUsed(NEWER)).toBe(0)
    expect(await getDailyQuotaUsed(OLDER)).toBe(0)
  })

  it('a malformed stored row reads as zero and recovers on the next write', async () => {
    await db.meta.put({ key: 'dailyQuotaUsage', value: 'not json' })
    expect(await getDailyQuotaUsed(NEWER)).toBe(0)
    await recordDailyRequest(NEWER)
    expect(await getDailyQuotaUsed(NEWER)).toBe(1)
  })

  it('a pre-split row is read as the default model’s tally, not discarded', async () => {
    const now = Date.parse('2026-07-30T10:00:00Z')
    await db.meta.put({
      key: 'dailyQuotaUsage',
      value: JSON.stringify({ day: '2026-07-30', count: 7 }),
    })

    expect(await getDailyQuotaUsed(NEWER, now)).toBe(7)
    expect(await getDailyQuotaUsed(OLDER, now)).toBe(0)

    // And the next write upgrades it in place without losing the carried count.
    await recordDailyRequest(NEWER, now)
    expect(await getDailyQuotaUsed(NEWER, now)).toBe(8)
  })

  it('replacing the API key resets the tally; re-saving the same key does not', async () => {
    await saveGeminiKey('first-key')
    await recordDailyRequest(NEWER)
    await recordDailyRequest(OLDER)
    expect(await getDailyQuotaUsed(NEWER)).toBe(1)

    await saveGeminiKey('first-key')
    expect(await getDailyQuotaUsed(NEWER)).toBe(1)
    expect(await getDailyQuotaUsed(OLDER)).toBe(1)

    await saveGeminiKey('second-key')
    expect(await getDailyQuotaUsed(NEWER)).toBe(0)
    expect(await getDailyQuotaUsed(OLDER)).toBe(0)
  })
})
