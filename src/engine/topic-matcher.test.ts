import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GeminiController } from '../providers/controller'
import type { GeminiAdapter, VisionResult } from '../providers/types'
import { saveGeminiKey } from '../state/credentials'
import { db } from '../state/db'
import { createRun, getArtifact, getRun, putArtifact, updateRun } from '../state/runs'
import type { TopicItem } from '../state/types'
import {
  applyTopicMatches,
  matchRunTopics,
  pendingMatchRows,
  readRunTopics,
  readTopicMatches,
  TOPIC_MATCH_MODEL,
  validateMatchChunk,
  type TopicMatchesArtifact,
} from './topic-matcher'
import type { MergedRow } from './types'

/** A scripted adapter: one queued response per call, in order. */
function scriptedAdapter() {
  const queue: VisionResult[] = []
  const calls: Array<{ prompt: string; modelId?: string; imageCount: number }> = []
  const adapter: GeminiAdapter = {
    id: 'gemini',
    name: 'Google Gemini',
    async probe() {
      return { ok: true }
    },
    async validateKey() {
      return { ok: true }
    },
    async listModels() {
      return { ok: true, modelIds: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'] }
    },
    async complete(request) {
      calls.push({
        prompt: request.prompt,
        modelId: request.modelId,
        imageCount: request.images.length,
      })
      const next = queue.shift()
      if (next === undefined) throw new Error('adapter script exhausted')
      return next
    },
  }
  return { adapter, calls, push: (...results: VisionResult[]) => queue.push(...results) }
}

function ok(text: string): VisionResult {
  return { ok: true, text, finishReason: 'STOP', usage: { totalTokens: 50 } }
}

function row(id: string, fill: Partial<MergedRow> = {}): MergedRow {
  return {
    id,
    group_id: '',
    topic: 'Planner heading',
    subtopic: '',
    year: '',
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma'],
    correct_index: '',
    image_urls: [],
    needs_review: '',
    ...fill,
  }
}

const TOPICS: TopicItem[] = [
  { topic: 'Surgery', subtopics: ['Appendix', 'Gallbladder'] },
  { topic: 'Pediatrics', subtopics: [] },
]

async function seedRun(
  rows: MergedRow[],
  topics: TopicItem[] | null = TOPICS,
): Promise<string> {
  const runId = await createRun({
    jobId: 'current',
    pdfId: 'pdf1',
    fileName: 'exam.pdf',
  })
  await updateRun(runId, { status: 'done' })
  await putArtifact({ runId, kind: 'merged-rows', json: rows })
  if (topics !== null) {
    await putArtifact({ runId, kind: 'topics-list', json: { topics } })
  }
  return runId
}

function matchesJson(
  entries: Array<{ id: string; topic: string; subtopic: string }>,
): string {
  return JSON.stringify({ matches: entries })
}

beforeEach(async () => {
  await db.runs.clear()
  await db.runArtifacts.clear()
  await db.credentials.clear()
  await db.meta.clear()
  await saveGeminiKey('local-key')
})

describe('matchRunTopics', () => {
  it('matches every row, caches the picks, and counts usage', async () => {
    const runId = await seedRun([row('1'), row('2')])
    const script = scriptedAdapter()
    script.push(
      ok(
        matchesJson([
          { id: '1', topic: 'Surgery', subtopic: 'Appendix' },
          { id: '2', topic: '', subtopic: '' },
        ]),
      ),
    )

    const outcome = await matchRunTopics(runId, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 1 })
    expect(script.calls).toHaveLength(1)
    expect(script.calls[0].modelId).toBe(TOPIC_MATCH_MODEL)
    expect(script.calls[0].imageCount).toBe(0)
    expect(script.calls[0].prompt).toContain('Question 1?')
    expect(script.calls[0].prompt).toContain('Surgery')
    expect((await readTopicMatches(runId))?.matches).toEqual({
      '1': { topic: 'Surgery', subtopic: 'Appendix' },
      '2': { topic: '', subtopic: '' },
    })
    expect((await getRun(runId))?.requestCount).toBe(1)
  })

  it('is a successful no-op when the run has no topics-list', async () => {
    const runId = await seedRun([row('1')], null)
    const script = scriptedAdapter()

    const outcome = await matchRunTopics(runId, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 0 })
    expect(script.calls).toHaveLength(0)
    expect(await readTopicMatches(runId)).toBeUndefined()
  })

  it('one repair retry on invalid content; still invalid → honest blanks', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()
    script.push(
      ok(matchesJson([{ id: '1', topic: 'Radiology', subtopic: '' }])),
      ok('not json at all'),
    )

    const outcome = await matchRunTopics(runId, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 2 })
    expect(script.calls[1].prompt).toContain('VALIDATION ERROR')
    expect(script.calls[1].prompt).toContain('not in the provided list')
    expect((await readTopicMatches(runId))?.matches['1']).toEqual({
      topic: '',
      subtopic: '',
    })
  })

  it('cached matches are never re-asked; retry sends only pending rows', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(String(i + 1)))
    const runId = await seedRun(rows)
    const script = scriptedAdapter()
    script.push(
      ok(
        matchesJson(
          rows.slice(0, 20).map((r) => ({ id: r.id, topic: 'Pediatrics', subtopic: '' })),
        ),
      ),
      { ok: false, kind: 'wrong-key', httpStatus: 400 },
    )
    const controller = new GeminiController(script.adapter)

    const first = await matchRunTopics(runId, { controller })
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.failure.kind).toBe('wrong-key')
    // The first chunk's twenty matches survived the stop.
    expect(Object.keys((await readTopicMatches(runId))?.matches ?? {})).toHaveLength(20)

    // Retry sends only the five pending rows.
    script.push(
      ok(
        matchesJson(
          rows.slice(20).map((r) => ({ id: r.id, topic: 'Surgery', subtopic: '' })),
        ),
      ),
    )
    const second = await matchRunTopics(runId, { controller })
    expect(second).toEqual({ ok: true, requestsMade: 1 })
    expect(script.calls[2].prompt).not.toContain('Question 1?')
    expect(script.calls[2].prompt).toContain('Question 21?')
    expect(Object.keys((await readTopicMatches(runId))?.matches ?? {})).toHaveLength(25)
  })

  it('never touches merged-rows or the run status', async () => {
    const rows = [row('1')]
    const runId = await seedRun(rows)
    const script = scriptedAdapter()
    script.push(ok(matchesJson([{ id: '1', topic: 'Surgery', subtopic: '' }])))

    await matchRunTopics(runId, { controller: new GeminiController(script.adapter) })

    expect((await getArtifact(runId, 'merged-rows'))?.json).toEqual(rows)
    expect((await getRun(runId))?.status).toBe('done')
  })
})

describe('validateMatchChunk', () => {
  const rows = [row('1'), row('2')]

  it('accepts a complete response with listed picks and blanks', () => {
    const result = validateMatchChunk(
      matchesJson([
        { id: '1', topic: 'Surgery', subtopic: 'Gallbladder' },
        { id: '2', topic: '', subtopic: '' },
      ]),
      rows,
      TOPICS,
    )
    expect(result.ok).toBe(true)
    expect(result.matches['1']).toEqual({ topic: 'Surgery', subtopic: 'Gallbladder' })
  })

  it('accepts a listed topic with a blank subtopic', () => {
    const result = validateMatchChunk(
      matchesJson([
        { id: '1', topic: 'Pediatrics', subtopic: '' },
        { id: '2', topic: 'Surgery', subtopic: '' },
      ]),
      rows,
      TOPICS,
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    ['not json', 'not JSON'],
    ['{"matches": "nope"}', 'missing "matches" array'],
    [matchesJson([{ id: 'x', topic: '', subtopic: '' }]), 'unknown row id'],
    [
      matchesJson([{ id: '1', topic: 'Radiology', subtopic: '' }]),
      'not in the provided list',
    ],
    [
      matchesJson([{ id: '1', topic: 'Surgery', subtopic: 'Neonates' }]),
      'not listed under',
    ],
    [
      matchesJson([{ id: '1', topic: 'Pediatrics', subtopic: 'Appendix' }]),
      'not listed under',
    ],
    [matchesJson([{ id: '1', topic: '', subtopic: 'Appendix' }]), 'subtopic without a topic'],
    [matchesJson([{ id: '1', topic: 'Surgery', subtopic: '' }]), 'missing matches'],
  ])('rejects %s', (text, errorPart) => {
    const result = validateMatchChunk(text, rows, TOPICS)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(errorPart)
  })
})

describe('applyTopicMatches', () => {
  const artifact = (
    matches: TopicMatchesArtifact['matches'],
  ): TopicMatchesArtifact => ({ matches, matchedAt: 1 })

  it('writes matches into topic/subtopic and is pure', () => {
    const input = [row('1')]
    const applied = applyTopicMatches(
      input,
      artifact({ '1': { topic: 'Surgery', subtopic: 'Appendix' } }),
    )
    expect(applied[0].topic).toBe('Surgery')
    expect(applied[0].subtopic).toBe('Appendix')
    // Purity: the input rows are untouched.
    expect(input[0].topic).toBe('Planner heading')
  })

  it('blanks unmatched rows so planner heading text never leaks', () => {
    const [applied] = applyTopicMatches([row('1')], artifact({}))
    expect(applied.topic).toBe('')
    expect(applied.subtopic).toBe('')
    const [noArtifact] = applyTopicMatches([row('1')], undefined)
    expect(noArtifact.topic).toBe('')
  })
})

describe('readRunTopics / pendingMatchRows', () => {
  it('rejects malformed topics-list artifacts', async () => {
    const runId = await seedRun([row('1')], null)
    await putArtifact({ runId, kind: 'topics-list', json: { topics: [{ topic: 7 }] } })
    expect(await readRunTopics(runId)).toBeUndefined()
  })

  it('an empty list reads as no topics', async () => {
    const runId = await seedRun([row('1')], [])
    expect(await readRunTopics(runId)).toBeUndefined()
  })

  it('pendingMatchRows subtracts cached entries', () => {
    const rows = [row('1'), row('2')]
    const cached: TopicMatchesArtifact = {
      matches: { '1': { topic: '', subtopic: '' } },
      matchedAt: 1,
    }
    expect(pendingMatchRows(rows, cached).map((r) => r.id)).toEqual(['2'])
    expect(pendingMatchRows(rows, undefined)).toHaveLength(2)
  })
})
