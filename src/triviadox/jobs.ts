/**
 * The Triviadox side of a Key facts job.
 *
 * Connect: Codox makes a random pair id and secret and opens
 * `<site>/codox/connect?kind=…#pair=…&k=…&t=…`. The secret rides in the URL
 * fragment, which browsers never send to a server. The manager signs in there,
 * picks subtopics, and Triviadox stores the job with only sha-256 of the
 * secret. Codox polls `/api/codox/pair` with `Authorization: Bearer <secret>`
 * until the job appears.
 *
 * The secret is the only Triviadox credential Codox ever holds: it opens that
 * one job, for 48 hours, for one submit. The Gemini key never goes to
 * Triviadox, and the job secret never goes to Gemini.
 */
import { openExternal } from '../external-open'
import { triviadoxOrigin } from './site'

export type JobKind = 'facts' | 'cards'
export type JobScope = 'missing' | 'all'

export interface Pairing {
  pairId: string
  secret: string
  kind: JobKind
  /** The Triviadox origin the pairing was opened against. */
  origin: string
  openedAt: number
}

export interface JobSubtopic {
  id: number
  name: string
  topic_id: number | null
  topic: string | null
}

export interface JobFact {
  id: number
  subtopicId: number
  text: string
  /** md5 of `text`; a card must quote it back so a fact edited meanwhile is caught. */
  md5: string
  hasCard: boolean
  cardStale: boolean
}

export interface JobQuestion {
  id: string
  subtopicId: number
  question: string
  options: string[]
  correctIndex: number
  /** How many images the question has (fetched separately). */
  images: number
  keyFactId: number | null
}

export interface JobPayload {
  job: { id: string; kind: JobKind; scope: JobScope; expiresAt: string; submitted: boolean }
  page: { id: number; label: string } | null
  subtopics: JobSubtopic[]
  facts: JobFact[]
  questions: JobQuestion[]
  prompts: { keyFacts: string; cards: string }
}

export interface RecheckResult {
  facts: JobFact[]
  linked: { id: string; keyFactId: number }[]
}

export interface SubmitBody {
  facts: { tmp: number; subtopicId: number; text: string; model: string }[]
  links: ({ qid: string; factId: number } | { qid: string; tmp: number })[]
  cards: { factId: number; factMd5: string; front: string; back: string; extra: string; model: string }[]
}

export interface SubmitResult {
  created: number
  deduped: number
  linked_new: number
  linked_existing: number
  skipped_linked: number
  skipped_invalid: number
  cards: number
  cards_skipped: number
}

/** A refusal from Triviadox, with its message for the screen. */
export class TriviadoxError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** How long Codox waits for the manager to send: the site refuses connect links older than 15 minutes. */
export const PAIR_POLL_TIMEOUT_MS = 14 * 60_000
export const PAIR_POLL_INTERVAL_MS = 3_000

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export function createPairing(kind: JobKind, now = Date.now()): Pairing {
  return { pairId: randomToken(18), secret: randomToken(32), kind, origin: triviadoxOrigin(), openedAt: now }
}

export function connectUrl(p: Pairing): string {
  const fragment = new URLSearchParams({ pair: p.pairId, k: p.secret, t: String(p.openedAt) })
  return `${p.origin}/codox/connect?kind=${p.kind}#${fragment.toString()}`
}

/** Opens the site's connect page in the user's real browser. */
export function openConnectPage(p: Pairing): Promise<void> {
  return openExternal(connectUrl(p))
}

async function call<T>(p: Pairing, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${p.origin}/api/codox/${path}${path.includes('?') ? '&' : '?'}id=${encodeURIComponent(p.pairId)}`, {
      ...init,
      signal,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${p.secret}` },
    })
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') throw e
    throw new TriviadoxError(0, "Can't reach Triviadox. Check the connection and try again.")
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new TriviadoxError(res.status, body.error ?? `Triviadox answered ${res.status}.`)
  return body as T
}

/** One poll: the job once the manager has sent it, or null while waiting. */
export async function fetchJob(p: Pairing, signal?: AbortSignal): Promise<JobPayload | null> {
  const body = await call<JobPayload | { waiting: true }>(p, 'pair', {}, signal)
  return 'waiting' in body ? null : body
}

/** Polls until the job exists, the window closes, or `signal` aborts. */
export async function waitForJob(p: Pairing, signal: AbortSignal, now: () => number = Date.now): Promise<JobPayload> {
  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const job = await fetchJob(p, signal)
      if (job) return job
    } catch (e) {
      // A dropped connection while waiting is not a reason to give up.
      if (!(e instanceof TriviadoxError) || e.status !== 0) throw e
    }
    if (now() - p.openedAt > PAIR_POLL_TIMEOUT_MS) {
      throw new TriviadoxError(410, 'Nothing was sent from Triviadox in time. Press Connect again.')
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, PAIR_POLL_INTERVAL_MS)
      signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
    })
  }
}

export function fetchQuestionImages(p: Pairing, questionId: string, signal?: AbortSignal) {
  return call<{ images: { label: string; mimeType: string; data: string }[] }>(
    p, `image?q=${encodeURIComponent(questionId)}`, {}, signal,
  ).then((r) => r.images)
}

export function recheckJob(p: Pairing, signal?: AbortSignal): Promise<RecheckResult> {
  return call<RecheckResult>(p, 'recheck', {}, signal)
}

export async function submitJob(p: Pairing, body: SubmitBody, signal?: AbortSignal): Promise<SubmitResult> {
  const r = await call<{ result: SubmitResult }>(
    p, 'submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal,
  )
  return r.result
}
