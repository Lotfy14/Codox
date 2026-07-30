import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  SELECTABLE_ENGINE_MODELS,
  type EngineModel,
} from '../providers/gemini'

/**
 * Device-local tally of Gemini requests made today, PER MODEL, for the daily
 * free-tier bars. Google's own counter is not readable with an API key, so
 * this counts what THIS installation sends: requests the same key makes from
 * another device are invisible to it, and each bar is a floor, not an exact
 * meter.
 *
 * Split per model (2026-07-30) because the allowance itself is per model —
 * the free-tier quota Gemini enforces is `…PerDayPerProjectPerModel-FreeTier`,
 * so one combined bar could read "full" while the model actually in use still
 * had most of its day left. The two bars are what tells a tutor which model
 * the controller can still fall back to.
 *
 * The day boundary is 00:00 UTC (when AI Studio's free tier resets). The
 * tally also resets when the stored API key is replaced — a new key starts
 * a new allowance (see credentials.ts).
 */

/** AI Studio free-tier daily request allowance, per model (owner-set, 2026-07-30). */
export const DAILY_FREE_REQUESTS_PER_MODEL = 500

const QUOTA_KEY = 'dailyQuotaUsage'

interface StoredDailyQuota {
  /** UTC day the tally belongs to, as YYYY-MM-DD. */
  day: string
  /** Requests sent today, keyed by model id. */
  counts: Record<string, number>
}

/** One model's bar. */
export interface DailyModelQuota {
  model: EngineModel
  used: number
  limit: number
}

function utcDayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function toCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined
}

/**
 * Reads a stored row, accepting the pre-split single-`count` shape. A legacy
 * count is attributed to the default model rather than discarded: before the
 * split every request went to a step's primary, which defaults to that model,
 * so it is the closest honest reading of a day already in progress.
 */
function parseStored(value: string | undefined): StoredDailyQuota | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value) as {
      day?: unknown
      count?: unknown
      counts?: unknown
    }
    if (typeof parsed.day !== 'string') return undefined

    if (typeof parsed.counts === 'object' && parsed.counts !== null) {
      const counts: Record<string, number> = {}
      for (const [model, raw] of Object.entries(parsed.counts)) {
        const count = toCount(raw)
        if (count !== undefined) counts[model] = count
      }
      return { day: parsed.day, counts }
    }

    const legacy = toCount(parsed.count)
    if (legacy !== undefined) {
      return {
        day: parsed.day,
        counts: { [DEFAULT_GEMINI_VISION_MODEL]: legacy },
      }
    }
  } catch {
    // Malformed rows read as "no tally yet".
  }
  return undefined
}

function countFor(
  stored: StoredDailyQuota | undefined,
  model: string,
  day: string,
): number {
  if (stored === undefined || stored.day !== day) return 0
  return stored.counts[model] ?? 0
}

/**
 * Counts one Gemini request against today's tally for the model that answered
 * it. Never throws — a failed tally write must not break the request that
 * triggered it.
 */
export async function recordDailyRequest(
  model: string,
  now = Date.now(),
): Promise<void> {
  try {
    await db.transaction('rw', db.meta, async () => {
      const today = utcDayOf(now)
      const stored = parseStored((await db.meta.get(QUOTA_KEY))?.value)
      const counts = stored?.day === today ? { ...stored.counts } : {}
      counts[model] = (counts[model] ?? 0) + 1
      await db.meta.put({
        key: QUOTA_KEY,
        value: JSON.stringify({ day: today, counts }),
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
      value: JSON.stringify({ day: utcDayOf(now), counts: {} }),
    })
  } catch {
    // Tally is informational only.
  }
}

/** One model's tally read (non-hook), for tests and non-React callers. */
export async function getDailyQuotaUsed(
  model: string,
  now = Date.now(),
): Promise<number> {
  const stored = parseStored((await db.meta.get(QUOTA_KEY))?.value)
  return countFor(stored, model, utcDayOf(now))
}

/**
 * Live per-model tallies for the header bars, in the order the models are
 * offered in Customize. The minute ticker lets the bars fall back to zero at
 * 00:00 UTC even when nothing writes to the tally.
 */
export function useDailyQuota(): DailyModelQuota[] {
  const stored = useLiveQuery(
    async () => parseStored((await db.meta.get(QUOTA_KEY))?.value),
    [],
  )
  const [day, setDay] = useState(() => utcDayOf(Date.now()))
  useEffect(() => {
    const timer = setInterval(() => setDay(utcDayOf(Date.now())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return SELECTABLE_ENGINE_MODELS.map((model) => ({
    model,
    used: countFor(stored, model, day),
    limit: DAILY_FREE_REQUESTS_PER_MODEL,
  }))
}
