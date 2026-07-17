import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/**
 * Device-local tally of Gemini requests made today, for the daily free-tier
 * bar. Google's own counter is not readable with an API key, so this counts
 * what THIS installation sends: requests the same key makes from another
 * device are invisible to it, and the bar is a floor, not an exact meter.
 *
 * The day boundary is 00:00 UTC (when AI Studio's free tier resets). The
 * tally also resets when the stored API key is replaced — a new key starts
 * a new allowance (see credentials.ts).
 */

/** AI Studio free-tier daily request allowance (owner-set, 2026-07-17). */
export const DAILY_FREE_REQUESTS = 400

const QUOTA_KEY = 'dailyQuotaUsage'

interface StoredDailyQuota {
  /** UTC day the tally belongs to, as YYYY-MM-DD. */
  day: string
  count: number
}

function utcDayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function parseStored(value: string | undefined): StoredDailyQuota | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<StoredDailyQuota>
    if (
      typeof parsed.day === 'string' &&
      typeof parsed.count === 'number' &&
      Number.isFinite(parsed.count)
    ) {
      return { day: parsed.day, count: Math.max(0, Math.floor(parsed.count)) }
    }
  } catch {
    // Malformed rows read as "no tally yet".
  }
  return undefined
}

/**
 * Counts one Gemini request against today's tally. Never throws — a failed
 * tally write must not break the request that triggered it.
 */
export async function recordDailyRequest(now = Date.now()): Promise<void> {
  try {
    await db.transaction('rw', db.meta, async () => {
      const today = utcDayOf(now)
      const stored = parseStored((await db.meta.get(QUOTA_KEY))?.value)
      const count = stored?.day === today ? stored.count + 1 : 1
      await db.meta.put({
        key: QUOTA_KEY,
        value: JSON.stringify({ day: today, count }),
      })
    })
  } catch {
    // Tally is informational only.
  }
}

/** Key replaced → the tally no longer describes the new key's allowance. */
export async function resetDailyQuota(now = Date.now()): Promise<void> {
  try {
    await db.meta.put({
      key: QUOTA_KEY,
      value: JSON.stringify({ day: utcDayOf(now), count: 0 }),
    })
  } catch {
    // Tally is informational only.
  }
}

/** Today's tally read (non-hook), for tests and non-React callers. */
export async function getDailyQuotaUsed(now = Date.now()): Promise<number> {
  const stored = parseStored((await db.meta.get(QUOTA_KEY))?.value)
  return stored?.day === utcDayOf(now) ? stored.count : 0
}

/**
 * Live tally for the header bar. The minute ticker lets the bar fall back
 * to zero at 00:00 UTC even when nothing writes to the tally.
 */
export function useDailyQuota(): { used: number; limit: number } {
  const stored = useLiveQuery(
    async () => parseStored((await db.meta.get(QUOTA_KEY))?.value),
    [],
  )
  const [day, setDay] = useState(() => utcDayOf(Date.now()))
  useEffect(() => {
    const timer = setInterval(() => setDay(utcDayOf(Date.now())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return {
    used: stored !== undefined && stored.day === day ? stored.count : 0,
    limit: DAILY_FREE_REQUESTS,
  }
}
