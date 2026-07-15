/**
 * The on-device diagnostics log. On-device only, never sent anywhere.
 * logEvent must never surface an error to its caller — a diagnostics
 * failure must never break the app.
 */
import { db } from './db'
import type { LogEvent } from './types'

const CAP = 500
const DETAIL_MAX = 8_000

export async function logEvent(entry: Omit<LogEvent, 'seq' | 't'> & { t?: number }): Promise<void> {
  try {
    const t = entry.t ?? Date.now()
    let detail = entry.detail
    if (detail) {
      detail = { ...detail }
      for (const [key, value] of Object.entries(detail)) {
        if (typeof value === 'string' && value.length > DETAIL_MAX) {
          detail[key] = value.slice(0, DETAIL_MAX) + '…[truncated]'
        }
      }
    }
    await db.logs.add({ ...entry, t, detail })
    const count = await db.logs.count()
    if (count > CAP) {
      const overflow = count - CAP
      const oldest = await db.logs.orderBy('seq').limit(overflow).primaryKeys()
      await db.logs.bulkDelete(oldest)
    }
  } catch {
    // Swallow: diagnostics must never break the app.
  }
}

export async function listEvents(): Promise<LogEvent[]> {
  return db.logs.orderBy('seq').reverse().toArray()
}

export async function clearEvents(seqs?: number[]): Promise<void> {
  if (seqs === undefined) {
    await db.logs.clear()
    return
  }
  await db.logs.bulkDelete(seqs)
}

export async function exportEventsBlob(seqs?: number[]): Promise<Blob> {
  const all = await db.logs.orderBy('seq').toArray()
  const events = seqs === undefined ? all : all.filter((event) => event.seq !== undefined && seqs.includes(event.seq))
  return new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
}