import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/**
 * App settings stored as `meta` key/value rows. Nothing here needs a
 * synchronous boot read (unlike the theme), so Dexie is the home.
 */
const LEGACY_FIRST_RUN_COMPLETED_AT = 'firstRunCompletedAt'
const API_COACHMARK_DISMISSED_AT = 'apiCoachmarkDismissedAt'

export async function dismissApiCoachmark(): Promise<void> {
  await db.meta.put({
    key: API_COACHMARK_DISMISSED_AT,
    value: new Date().toISOString(),
  })
}

/**
 * Whether the one-time API coachmark has been dismissed. Completing the old
 * walkthrough also counts, so existing users are not onboarded twice.
 */
export function useApiCoachmarkDismissed(): boolean | null {
  const entries = useLiveQuery(
    () =>
      db.meta.bulkGet([
        API_COACHMARK_DISMISSED_AT,
        LEGACY_FIRST_RUN_COMPLETED_AT,
      ]),
    [],
    null,
  )
  if (entries === null) return null
  return entries.some((entry) => entry !== undefined)
}
