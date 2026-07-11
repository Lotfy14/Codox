import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/**
 * App settings stored as `meta` key/value rows. Nothing here needs a
 * synchronous boot read (unlike the theme), so Dexie is the home.
 */
const FIRST_RUN_COMPLETED_AT = 'firstRunCompletedAt'

export async function markFirstRunCompleted(): Promise<void> {
  await db.meta.put({
    key: FIRST_RUN_COMPLETED_AT,
    value: new Date().toISOString(),
  })
}

/**
 * Whether the first-run walkthrough has been completed (or skipped).
 * `null` while the first read is in flight — render nothing yet rather
 * than flashing the walkthrough at returning users.
 */
export function useFirstRunCompleted(): boolean | null {
  const entry = useLiveQuery(() => db.meta.get(FIRST_RUN_COMPLETED_AT), [], null)
  if (entry === null) return null
  return entry !== undefined
}
