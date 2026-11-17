/**
 * Runs a Key facts job: Gemini calls under the device's one key, through the
 * shared controller (pacing, quota pause, model fallback), saving the job
 * after every request so it resumes where it stopped.
 *
 * Key facts — one subtopic at a time, 25 questions a request, with EVERY
 *   existing fact of the subtopic plus the facts this run already wrote in
 *   the prompt (owner rule: a question must never get a new fact when one
 *   already covers it). Same prompt and reply contract as Triviadox's own
 *   generator; the prompt comes from the job.
 * Flashcards — 20 facts a request, one card per fact or SKIP, checked by
 *   `cardProblems` before it is kept.
 * Export — re-read the subtopics first (`recheckJob`): facts added on the site
 *   meanwhile are matched against Codox's new ones (one request per affected
 *   subtopic), questions linked meanwhile are left alone, cards whose fact
 *   changed are dropped. Then one submit; Triviadox checks everything again.
 */
import { geminiController, type GeminiController } from '../providers/controller'
import type { VisionRequest } from '../providers/types'
import {
  fetchQuestionImages, recheckJob, submitJob,
  type JobFact, type JobQuestion, type SubmitBody,
} from '../triviadox/jobs'
import { FACTS_PER_REQUEST, KEY_FACT_MODES, QUESTIONS_PER_REQUEST } from './models'
import {
  buildCardsUserMessage, buildFactsUserMessage, buildReconcilePrompt, cardProblems, NEW_FACT_ID_BASE,
  parseCardsReply, parseFactsReply, parseReconcileReply,
} from './prompts'
import { saveKfJob, type KfJob } from './state'

/** Why a run stopped, worded for the screen. */
export class RunStop extends Error {
  readonly kind: 'wrong-key' | 'aborted' | 'provider' | 'triviadox'
  constructor(kind: RunStop['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

interface Deps {
  controller?: GeminiController
  signal: AbortSignal
  /** Called after every saved step with the job as it now stands. */
  onUpdate?: (job: KfJob) => void
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

async function ask(job: KfJob, prompt: string, images: VisionRequest['images'], maxOutputTokens: number, deps: Deps) {
  const pair = KEY_FACT_MODES[job.mode]
  const result = await (deps.controller ?? geminiController).runGeminiRequest({
    prompt,
    images,
    modelId: pair.primary,
    fallbackModelId: pair.fallback,
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens },
  }, { signal: deps.signal })
  job.requests += 1
  if (result.ok) return { text: result.text, model: result.model ?? pair.primary }
  if (result.kind === 'aborted') throw new RunStop('aborted', 'Stopped.')
  if (result.kind === 'wrong-key') throw new RunStop('wrong-key', 'Gemini refused the key. Check it under API key.')
  throw new RunStop('provider', 'Gemini could not answer right now. Press Continue to try again.')
}

async function save(job: KfJob, deps: Deps) {
  await saveKfJob(job)
  deps.onUpdate?.(structuredClone(job))
}

/** Questions this job still has to give a fact to. */
export function pendingQuestions(job: KfJob): JobQuestion[] {
  const done = new Set(job.handled)
  const scopeAll = job.payload?.job.scope === 'all'
  return (job.payload?.questions ?? []).filter((q) => !done.has(q.id) && (scopeAll || q.keyFactId === null))
}

/** Facts this job still has to write a card for. */
export function pendingFacts(job: KfJob): JobFact[] {
  const done = new Set(job.handled)
  const scopeAll = job.payload?.job.scope === 'all'
  return (job.payload?.facts ?? []).filter((f) => !done.has(String(f.id)) && (scopeAll || !f.hasCard || f.cardStale))
}

/** Gives up on an item the model left out twice; returns true when it is out. */
function strike(job: KfJob, id: string, reason: string): boolean {
  const n = (job.attempts[id] ?? 0) + 1
  job.attempts[id] = n
  if (n < 2) return false
  job.handled.push(id)
  job.skipped.push({ id, reason })
  return true
}

async function runFacts(job: KfJob, deps: Deps) {
  const payload = job.payload!
  for (const sub of payload.subtopics) {
    for (;;) {
      const batch = pendingQuestions(job).filter((q) => q.subtopicId === sub.id).slice(0, QUESTIONS_PER_REQUEST)
      if (batch.length === 0) break
      if (deps.signal.aborted) throw new RunStop('aborted', 'Stopped.')

      const existing = [
        ...payload.facts.filter((f) => f.subtopicId === sub.id).map((f) => ({ id: f.id, text: f.text })),
        ...job.newFacts.filter((f) => f.subtopicId === sub.id).map((f) => ({ id: NEW_FACT_ID_BASE + f.tmp, text: f.text })),
      ]
      const images: VisionRequest['images'][number][] = []
      const notes: string[] = []
      for (const [i, q] of batch.entries()) {
        if (q.images === 0) continue
        try {
          for (const img of await fetchQuestionImages(job.pairing, q.id, deps.signal)) {
            images.push({ mimeType: img.mimeType, base64Data: img.data })
            notes.push(`Image ${images.length}: Question ${i + 1}`)
          }
        } catch {
          // A picture that can't be fetched leaves the question text-only.
        }
      }
      const prompt = `${payload.prompts.keyFacts}\n\n${buildFactsUserMessage(batch, existing, notes)}`
      const { text, model } = await ask(job, prompt, images, Math.min(8192, 400 + batch.length * 150), deps)

      const known = new Set(existing.map((f) => f.id))
      const { newFacts, links } = parseFactsReply(text, batch.length, known)
      const tmpForIndex = new Map<number, number>()
      const tmpForText = new Map(job.newFacts.filter((f) => f.subtopicId === sub.id).map((f) => [normalize(f.text), f.tmp]))
      const answered = new Set<number>()
      for (const l of links) {
        const q = batch[l.q - 1]
        answered.add(l.q)
        if ('matchId' in l) {
          job.links.push(l.matchId >= NEW_FACT_ID_BASE ? { qid: q.id, tmp: l.matchId - NEW_FACT_ID_BASE } : { qid: q.id, factId: l.matchId })
        } else {
          let tmp = tmpForIndex.get(l.newIndex)
          if (tmp === undefined) {
            const text = newFacts[l.newIndex]
            tmp = tmpForText.get(normalize(text))
            if (tmp === undefined) {
              tmp = job.newFacts.length
              job.newFacts.push({ tmp, subtopicId: sub.id, text, model })
              tmpForText.set(normalize(text), tmp)
            }
            tmpForIndex.set(l.newIndex, tmp)
          }
          job.links.push({ qid: q.id, tmp })
        }
        job.handled.push(q.id)
      }
      batch.forEach((q, i) => { if (!answered.has(i + 1)) strike(job, q.id, 'Gemini gave no usable fact twice') })
      await save(job, deps)
    }
  }
}

async function runCards(job: KfJob, deps: Deps) {
  const payload = job.payload!
  for (;;) {
    const batch = pendingFacts(job).slice(0, FACTS_PER_REQUEST)
    if (batch.length === 0) break
    if (deps.signal.aborted) throw new RunStop('aborted', 'Stopped.')
    const prompt = `${payload.prompts.cards}\n\n${buildCardsUserMessage(batch)}`
    const { text, model } = await ask(job, prompt, [], Math.min(8192, 300 + batch.length * 120), deps)
    const outcomes = parseCardsReply(text, batch.map((f) => f.id))
    for (const f of batch) {
      const o = outcomes.get(f.id)!
      if (o.kind === 'card') {
        job.cards.push({ factId: f.id, factMd5: f.md5, ...o.card, model })
        job.handled.push(String(f.id))
      } else if (o.kind === 'skip') {
        job.handled.push(String(f.id))
        job.skipped.push({ id: String(f.id), reason: 'Too thin to make a card' })
      } else {
        strike(job, String(f.id), o.reason)
      }
    }
    await save(job, deps)
  }
}

/** Generates everything still pending. Safe to call again after a stop. */
export async function runJob(job: KfJob, deps: Deps): Promise<KfJob> {
  if (!job.payload) throw new RunStop('triviadox', 'This job has nothing from Triviadox yet.')
  job.status = 'running'
  job.error = undefined
  await save(job, deps)
  try {
    if (job.kind === 'facts') await runFacts(job, deps)
    else await runCards(job, deps)
    job.status = 'done'
  } catch (e) {
    job.status = 'ready'
    job.error = e instanceof RunStop ? (e.kind === 'aborted' ? undefined : e.message) : 'Something went wrong. Press Continue to try again.'
    await save(job, deps)
    throw e
  }
  await save(job, deps)
  return job
}

/**
 * The submit body after re-reading the site: Codox's new facts that repeat a
 * fact added meanwhile are pointed at it, questions linked meanwhile are left
 * alone (Missing only), and cards whose fact changed or got a card are dropped.
 */
export async function prepareExport(job: KfJob, deps: Deps): Promise<SubmitBody> {
  const payload = job.payload!
  const now = await recheckJob(job.pairing, deps.signal)
  const missingOnly = payload.job.scope === 'missing'

  if (job.kind === 'cards') {
    const current = new Map(now.facts.map((f) => [f.id, f]))
    // Re-run the card checks: a rule added after the cards were written (e.g.
    // no "which … is not" questions) still applies to this run's export.
    const checked = job.cards.filter((c) => {
      const problems = cardProblems(c)
      if (problems.length) job.skipped.push({ id: String(c.factId), reason: problems.join(', ') })
      return problems.length === 0
    })
    job.cards = checked
    await save(job, deps)
    const cards = checked.filter((c) => {
      const f = current.get(c.factId)
      if (!f || f.md5 !== c.factMd5) return false
      return !(missingOnly && f.hasCard && !f.cardStale)
    })
    return { facts: [], links: [], cards }
  }

  const known = new Set(payload.facts.map((f) => f.id))
  const linkedNow = new Set(now.linked.map((l) => l.id))
  const replaced = new Map<number, number>() // tmp -> site fact id
  for (const sub of payload.subtopics) {
    const siteNew = now.facts.filter((f) => f.subtopicId === sub.id && !known.has(f.id))
    const ours = job.newFacts.filter((f) => f.subtopicId === sub.id)
    if (siteNew.length === 0 || ours.length === 0) continue
    const { text } = await ask(job, buildReconcilePrompt(siteNew, ours.map((f) => f.text)), [], 2048, deps)
    for (const [i, id] of parseReconcileReply(text, ours.length, new Set(siteNew.map((f) => f.id)))) replaced.set(ours[i].tmp, id)
  }
  await save(job, deps)

  const links = job.links
    .filter((l) => !(missingOnly && linkedNow.has(l.qid)))
    .map((l) => ('tmp' in l && replaced.has(l.tmp) ? { qid: l.qid, factId: replaced.get(l.tmp)! } : l))
  const usedTmp = new Set(links.flatMap((l) => ('tmp' in l ? [l.tmp] : [])))
  const facts = job.newFacts.filter((f) => usedTmp.has(f.tmp))
  return { facts, links, cards: [] }
}

/** Re-checks, sends, and records Triviadox's answer on the job. */
export async function exportJob(job: KfJob, deps: Deps): Promise<KfJob> {
  const body = await prepareExport(job, deps)
  try {
    job.result = await submitJob(job.pairing, body, deps.signal)
  } catch (e) {
    job.error = e instanceof Error ? e.message : 'Triviadox did not take the export.'
    await save(job, deps)
    throw e
  }
  job.status = 'sent'
  job.error = undefined
  await save(job, deps)
  return job
}
