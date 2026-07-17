import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GeminiController } from '../providers/controller'
import type { GeminiAdapter, VisionResult } from '../providers/types'
import { saveGeminiKey } from '../state/credentials'
import { db } from '../state/db'
import { createRun, getRun, putArtifact, updateRun } from '../state/runs'
import {
  clearAiAnswers,
  readAiAnswers,
  solveRows,
  SOLVER_MODEL,
  validateSolverChunk,
} from './solver'
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
    topic: 'Surgery',
    subtopic: '',
    year: '',
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma'],
    correct_index: '',
    image_urls: [],
    needs_review: 'no_answer_key',
    ...fill,
  }
}

async function seedRun(rows: MergedRow[]): Promise<string> {
  const runId = await createRun({
    jobId: 'current',
    pdfId: 'pdf1',
    fileName: 'exam.pdf',
  })
  await updateRun(runId, { status: 'done' })
  await putArtifact({ runId, kind: 'merged-rows', json: rows })
  return runId
}

function answersJson(
  entries: Array<{ id: string; index: number | null; confidence: string }>,
): string {
  return JSON.stringify({
    answers: entries.map((entry) => ({
      id: entry.id,
      correct_index: entry.index,
      confidence: entry.confidence,
    })),
  })
}

beforeEach(async () => {
  await db.runs.clear()
  await db.runArtifacts.clear()
  await db.credentials.clear()
  await db.meta.clear()
  await saveGeminiKey('local-key')
})

describe('solveRows', () => {
  it('solves the requested rows, caches the answers, and counts usage', async () => {
    const runId = await seedRun([
      row('1', { correct_index: '2', needs_review: '' }),
      row('2'),
      row('3'),
    ])
    const script = scriptedAdapter()
    script.push(
      ok(
        answersJson([
          { id: '2', index: 1, confidence: 'certain' },
          { id: '3', index: null, confidence: 'unsure' },
        ]),
      ),
    )

    const outcome = await solveRows(runId, ['2', '3'], {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 1 })
    expect(script.calls).toHaveLength(1)
    expect(script.calls[0].modelId).toBe('gemini-3.1-flash-lite')
    expect(script.calls[0].modelId).toBe(SOLVER_MODEL)
    expect(script.calls[0].prompt.startsWith('You are answering multiple-choice')).toBe(true)
    const cached = await readAiAnswers(runId)
    expect(cached?.answers).toEqual({
      '2': { index: 1, confidence: 'certain' },
      '3': { index: null, confidence: 'unsure' },
    })
    expect((await getRun(runId))?.requestCount).toBe(1)
  })

  it('sends formatted question text with its referenced image crops', async () => {
    const runId = await seedRun([row('1', { image_urls: ['images/q1.jpg'] })])
    await putArtifact({
      runId,
      kind: 'crop',
      path: 'images/q1.jpg',
      bytes: new Uint8Array([9, 9]),
    })
    const script = scriptedAdapter()
    script.push(ok(answersJson([{ id: '1', index: 0, confidence: 'likely' }])))

    await solveRows(runId, ['1'], {
      controller: new GeminiController(script.adapter),
    })

    expect(script.calls[0].imageCount).toBe(1)
    expect(script.calls[0].prompt).toContain('Question 1?')
    expect(script.calls[0].prompt).toContain('Alpha')
    expect(script.calls[0].prompt).toContain('images/q1.jpg')
  })

  it('sends every selected question across flash-lite chunks', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(String(index + 1)))
    const runId = await seedRun(rows)
    const script = scriptedAdapter()
    script.push(
      ok(answersJson(rows.slice(0, 10).map((entry) => ({
        id: entry.id,
        index: 0,
        confidence: 'certain',
      })))),
      ok(answersJson(rows.slice(10).map((entry) => ({
        id: entry.id,
        index: 1,
        confidence: 'likely',
      })))),
    )

    await solveRows(runId, rows.map((entry) => entry.id), {
      controller: new GeminiController(script.adapter),
    })

    expect(script.calls).toHaveLength(2)
    expect(script.calls.every((call) => call.modelId === SOLVER_MODEL)).toBe(true)
    expect(script.calls.every((call) => call.imageCount === 0)).toBe(true)
    const prompts = script.calls.map((call) => call.prompt).join('\n')
    for (const entry of rows) expect(prompts).toContain(entry.question)
  })

  it('one repair retry on invalid content; still invalid → honest unsure', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()
    script.push(
      ok('not json at all'),
      ok(answersJson([{ id: 'foreign', index: 0, confidence: 'certain' }])),
    )

    const outcome = await solveRows(runId, ['1'], {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 2 })
    expect(script.calls).toHaveLength(2)
    expect(script.calls[1].prompt).toContain('VALIDATION ERROR')
    expect((await readAiAnswers(runId))?.answers['1']).toEqual({
      index: null,
      confidence: 'unsure',
    })
  })

  it('clearing the cached answers drops the artifact', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()
    script.push(ok(answersJson([{ id: '1', index: 2, confidence: 'certain' }])))

    await solveRows(runId, ['1'], {
      controller: new GeminiController(script.adapter),
    })
    expect((await readAiAnswers(runId))?.answers['1']).toEqual({
      index: 2,
      confidence: 'certain',
    })

    await clearAiAnswers(runId)
    expect(await readAiAnswers(runId)).toBeUndefined()
  })

  it('a provider stop returns the failure; answered chunks stay cached', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(String(i + 1)))
    const runId = await seedRun(rows)
    const script = scriptedAdapter()
    script.push(
      ok(
        answersJson(
          rows.slice(0, 10).map((r) => ({ id: r.id, index: 0, confidence: 'certain' })),
        ),
      ),
      { ok: false, kind: 'wrong-key', httpStatus: 400 },
    )

    const outcome = await solveRows(runId, rows.map((r) => r.id), {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.kind).toBe('wrong-key')
    // The first chunk's ten answers survived the stop.
    expect(Object.keys((await readAiAnswers(runId))?.answers ?? {})).toHaveLength(10)
  })
  it('sends exactly the requested rows, answered or not', async () => {
    const runId = await seedRun([
      row('1', { correct_index: '2', needs_review: '' }),
      row('2'),
      row('3'),
    ])
    const script = scriptedAdapter()
    script.push(
      ok(
        answersJson([
          { id: '1', index: 0, confidence: 'certain' },
          { id: '3', index: 1, confidence: 'likely' },
        ]),
      ),
    )

    const outcome = await solveRows(runId, ['1', '3'], {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 1 })
    expect(script.calls).toHaveLength(1)
    expect(script.calls[0].prompt).toContain('Question 1?')
    expect(script.calls[0].prompt).toContain('Question 3?')
    expect(script.calls[0].prompt).not.toContain('Question 2?')
    expect((await readAiAnswers(runId))?.answers).toEqual({
      '1': { index: 0, confidence: 'certain' },
      '3': { index: 1, confidence: 'likely' },
    })
  })

  it('re-asks a cached row and overwrites only its answer', async () => {
    const runId = await seedRun([row('1'), row('2')])
    const script = scriptedAdapter()
    const controller = new GeminiController(script.adapter)
    script.push(
      ok(
        answersJson([
          { id: '1', index: 0, confidence: 'likely' },
          { id: '2', index: 1, confidence: 'certain' },
        ]),
      ),
      ok(answersJson([{ id: '1', index: 2, confidence: 'certain' }])),
    )

    await solveRows(runId, ['1', '2'], { controller })
    await solveRows(runId, ['1'], { controller })

    expect(script.calls).toHaveLength(2)
    expect((await readAiAnswers(runId))?.answers).toEqual({
      '1': { index: 2, confidence: 'certain' },
      '2': { index: 1, confidence: 'certain' },
    })
  })

  it('unknown row ids are ignored — no request is made', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()

    const outcome = await solveRows(runId, ['nope'], {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 0 })
    expect(script.calls).toHaveLength(0)
  })
})

describe('validateSolverChunk', () => {
  const rows = [row('1'), row('2')]

  it('accepts a complete, in-range response', () => {
    const result = validateSolverChunk(
      answersJson([
        { id: '1', index: 2, confidence: 'certain' },
        { id: '2', index: null, confidence: 'unsure' },
      ]),
      rows,
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    ['not json', 'not JSON'],
    ['{"answers": "nope"}', 'missing "answers" array'],
    [answersJson([{ id: 'x', index: 0, confidence: 'certain' }]), 'unknown row id'],
    [answersJson([{ id: '1', index: 3, confidence: 'certain' }]), 'out of range'],
    [answersJson([{ id: '1', index: -1, confidence: 'certain' }]), 'out of range'],
    [answersJson([{ id: '1', index: 0, confidence: 'sure!' }]), 'invalid confidence'],
    [answersJson([{ id: '1', index: 0, confidence: 'certain' }]), 'missing answers'],
  ])('rejects %s', (text, errorPart) => {
    const result = validateSolverChunk(text, rows)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(errorPart)
  })
})

