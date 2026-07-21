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

  it('one bad row is retried alone and its good neighbours survive', async () => {
    const rows = [row('1'), row('2'), row('3')]
    const runId = await seedRun(rows)
    const script = scriptedAdapter()
    // First response: row 2 carries an unlisted topic; 1 and 3 are valid.
    script.push(
      ok(
        matchesJson([
          { id: '1', topic: 'Surgery', subtopic: '' },
          { id: '2', topic: 'Radiology', subtopic: '' },
          { id: '3', topic: 'Pediatrics', subtopic: '' },
        ]),
      ),
      // Retry sends only row 2; this time it's valid.
      ok(matchesJson([{ id: '2', topic: 'Surgery', subtopic: 'Appendix' }])),
    )

    const outcome = await matchRunTopics(runId, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 2 })
    // The retry request must carry only the offending row.
    expect(script.calls[1].prompt).toContain('Question 2?')
    expect(script.calls[1].prompt).not.toContain('Question 1?')
    expect(script.calls[1].prompt).not.toContain('Question 3?')
    expect((await readTopicMatches(runId))?.matches).toEqual({
      '1': { topic: 'Surgery', subtopic: '' },
      '2': { topic: 'Surgery', subtopic: 'Appendix' },
      '3': { topic: 'Pediatrics', subtopic: '' },
    })
  })

  it('a row still bad after its retry blanks only itself', async () => {
    const rows = [row('1'), row('2'), row('3')]
    const runId = await seedRun(rows)
    const script = scriptedAdapter()
    script.push(
      ok(
        matchesJson([
          { id: '1', topic: 'Surgery', subtopic: '' },
          { id: '2', topic: 'Radiology', subtopic: '' },
          { id: '3', topic: 'Pediatrics', subtopic: '' },
        ]),
      ),
      // Retry still unlisted → row 2 stays honestly blank.
      ok(matchesJson([{ id: '2', topic: 'Cardiology', subtopic: '' }])),
    )

    const outcome = await matchRunTopics(runId, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 2 })
    expect((await readTopicMatches(runId))?.matches).toEqual({
      '1': { topic: 'Surgery', subtopic: '' },
      '2': { topic: '', subtopic: '' },
      '3': { topic: 'Pediatrics', subtopic: '' },
    })
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
    expect(result.structuralError).toBeUndefined()
    expect(result.invalidIds).toEqual([])
    expect(result.matches['1']).toEqual({ topic: 'Surgery', subtopic: 'Gallbladder' })
    expect(result.matches['2']).toEqual({ topic: '', subtopic: '' })
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
    expect(result.invalidIds).toEqual([])
    expect(Object.keys(result.matches)).toHaveLength(2)
  })

  it.each([
    ['not json', 'not JSON'],
    ['{"matches": "nope"}', 'missing "matches" array'],
  ])('flags %s as a structural error (whole response unusable)', (text, part) => {
    const result = validateMatchChunk(text, rows, TOPICS)
    expect(result.structuralError).toContain(part)
    expect(result.matches).toEqual({})
    expect(result.invalidIds).toEqual(['1', '2'])
  })

  it.each([
    [
      matchesJson([
        { id: '1', topic: 'Radiology', subtopic: '' },
        { id: '2', topic: 'Surgery', subtopic: '' },
      ]),
      'not in the provided list',
    ],
    [
      matchesJson([
        { id: '1', topic: 'Surgery', subtopic: 'Neonates' },
        { id: '2', topic: 'Surgery', subtopic: '' },
      ]),
      'not listed under',
    ],
    [
      matchesJson([
        { id: '1', topic: 'Pediatrics', subtopic: 'Appendix' },
        { id: '2', topic: 'Surgery', subtopic: '' },
      ]),
      'not listed under',
    ],
    [
      matchesJson([
        { id: '1', topic: '', subtopic: 'Appendix' },
        { id: '2', topic: 'Surgery', subtopic: '' },
      ]),
      'subtopic without a topic',
    ],
    [
      matchesJson([{ id: '2', topic: 'Surgery', subtopic: '' }]),
      'no match returned',
    ],
  ])(
    'marks only the bad row invalid and keeps the good one (%#)',
    (text, errorPart) => {
      const result = validateMatchChunk(text, rows, TOPICS)
      expect(result.structuralError).toBeUndefined()
      // Row 2 always validated; only row 1 is invalid.
      expect(result.invalidIds).toEqual(['1'])
      expect(result.matches['2']).toEqual({ topic: 'Surgery', subtopic: '' })
      expect(result.matches['1']).toBeUndefined()
      expect(result.firstError).toContain(errorPart)
    },
  )

  it('ignores unknown ids that were not requested', () => {
    const result = validateMatchChunk(
      matchesJson([
        { id: '1', topic: 'Surgery', subtopic: '' },
        { id: '2', topic: 'Pediatrics', subtopic: '' },
        { id: 'ghost', topic: 'Surgery', subtopic: '' },
      ]),
      rows,
      TOPICS,
    )
    expect(result.invalidIds).toEqual([])
    expect(Object.keys(result.matches).sort()).toEqual(['1', '2'])
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
