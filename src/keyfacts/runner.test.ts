import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { JobFact, JobPayload } from '../triviadox/jobs'
import { pendingFacts, THIN_REASON, thinSkips } from './runner'
import { newKfJob, type KfJob } from './state'

const md5 = (c: string) => c.repeat(32)
const fact = (id: number, extra: Partial<JobFact> = {}): JobFact =>
  ({ id, subtopicId: 1, text: `Fact ${id}`, md5: md5('a'), hasCard: false, cardStale: false, ...extra })

function cardsJob(scope: 'missing' | 'all', facts: JobFact[]): KfJob {
  const job = newKfJob({ pairId: 'p'.repeat(20), secret: 's'.repeat(43), kind: 'cards', origin: 'https://beta.triviadox.com', openedAt: 1 }, 'normal')
  job.payload = {
    job: { id: 'j', kind: 'cards', scope, expiresAt: '', submitted: false },
    page: null, subtopics: [], facts, questions: [], prompts: { keyFacts: '', cards: '' },
  } satisfies JobPayload
  return job
}

describe('pendingFacts', () => {
  const facts = [
    fact(1),
    fact(2, { hasCard: true }),
    fact(3, { hasCard: true, cardStale: true }),
    fact(4, { skipped: true }),
  ]

  it('Missing only leaves out carded facts and facts already judged too thin', () => {
    expect(pendingFacts(cardsJob('missing', facts)).map((f) => f.id)).toEqual([1, 3])
  })

  it('Redo all takes every fact, skipped ones included', () => {
    expect(pendingFacts(cardsJob('all', facts)).map((f) => f.id)).toEqual([1, 2, 3, 4])
  })

  it('works with a site that sends no skipped flag', () => {
    expect(pendingFacts(cardsJob('missing', [fact(5)])).map((f) => f.id)).toEqual([5])
  })
})

describe('thinSkips', () => {
  it("sends only the model's own SKIPs, once each, for text the site still has", () => {
    const job = cardsJob('missing', [fact(1), fact(2), fact(3), fact(4)])
    job.skipped = [
      { id: '1', reason: THIN_REASON, model: 'gemini-3.1-flash-lite' },
      { id: '1', reason: THIN_REASON, model: 'gemini-3.1-flash-lite' },
      { id: '2', reason: 'asks "which … is not"' },   // a failed check: retried next time instead
      { id: '3', reason: THIN_REASON },                // edited on the site meanwhile
      { id: '4', reason: THIN_REASON },                // this export carries a card for it
    ]
    const current = new Map([fact(1), fact(2), fact(3, { md5: md5('b') }), fact(4)].map((f) => [f.id, f]))
    expect(thinSkips(job, current, new Set([4]))).toEqual([
      { factId: 1, factMd5: md5('a'), model: 'gemini-3.1-flash-lite' },
    ])
  })

  it('drops a skip for a fact the site no longer has', () => {
    const job = cardsJob('missing', [fact(1)])
    job.skipped = [{ id: '1', reason: THIN_REASON }]
    expect(thinSkips(job, new Map(), new Set())).toEqual([])
  })
})
