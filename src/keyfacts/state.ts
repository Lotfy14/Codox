/**
 * A Key facts job as Codox keeps it on the device (Dexie `kfJobs`, one row per
 * Connect). Saved after every Gemini request, so a run that pauses on quota —
 * Pro has only 20 requests a day — or an app that is closed picks up exactly
 * where it stopped. Nothing here leaves the device except through Export.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../state/db'
import type { JobKind, JobPayload, Pairing, SubmitBody, SubmitResult } from '../triviadox/jobs'
import type { KeyFactMode } from './models'

export type KfStatus =
  /** Connect page open; waiting for the manager to send from Triviadox. */
  | 'waiting'
  /** Job received; nothing generated yet, or stopped part way. */
  | 'ready'
  | 'running'
  /** Everything generated; ready to export. */
  | 'done'
  /** Exported to Triviadox. */
  | 'sent'

export interface NewFact {
  /** Codox's own number for the fact until Triviadox gives it an id. */
  tmp: number
  subtopicId: number
  text: string
  model: string
}

export interface Skipped {
  /** Question id (facts) or key fact id (cards). */
  id: string
  reason: string
  /** The model that judged a fact too thin (flashcards only). */
  model?: string
}

export interface KfJob {
  /** The pair id. */
  id: string
  kind: JobKind
  pairing: Pairing
  createdAt: number
  status: KfStatus
  payload?: JobPayload
  mode: KeyFactMode
  newFacts: NewFact[]
  links: SubmitBody['links']
  cards: SubmitBody['cards']
  /** Question ids (facts) or fact ids as strings (cards) already handled. */
  handled: string[]
  /** Items the model gave nothing usable for, with why. */
  skipped: Skipped[]
  /** Second-chance counter for items the model left out of a reply. */
  attempts: Record<string, number>
  requests: number
  result?: SubmitResult
  /** The last thing that stopped a run, for the screen. */
  error?: string
}

export function newKfJob(pairing: Pairing, mode: KeyFactMode): KfJob {
  return {
    id: pairing.pairId,
    kind: pairing.kind,
    pairing,
    createdAt: pairing.openedAt,
    status: 'waiting',
    mode,
    newFacts: [],
    links: [],
    cards: [],
    handled: [],
    skipped: [],
    attempts: {},
    requests: 0,
  }
}

export function saveKfJob(job: KfJob): Promise<string> {
  return db.kfJobs.put(job)
}

export function deleteKfJob(id: string): Promise<void> {
  return db.kfJobs.delete(id)
}

/** The newest job of each kind, live, for the Key facts area. */
export function useLatestKfJob(kind: JobKind): KfJob | null | undefined {
  return useLiveQuery(async () => {
    const all = await db.kfJobs.where('kind').equals(kind).toArray()
    all.sort((a, b) => b.createdAt - a.createdAt)
    return all[0] ?? null
  }, [kind])
}
