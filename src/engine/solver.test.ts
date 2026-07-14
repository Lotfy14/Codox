import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GeminiController } from '../providers/controller'
import type { GeminiAdapter, VisionResult } from '../providers/types'
import { saveGeminiKey } from '../state/credentials'
import { db } from '../state/db'
import { createRun, getRun, putArtifact, updateRun } from '../state/runs'
import type { AiAnswerSettings } from '../state/ai-answers-settings'
import {
  applyAiAnswers,
  clearAiAnswers,
  pendingRows,
  readAiAnswers,
  solveRun,
  validateSolverChunk,
  type AiAnswersArtifact,
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

const SETTINGS: AiAnswerSettings = { scope: 'unanswered', flagBelow: 'certain' }

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

describe('solveRun', () => {
  it('solves only the unanswered rows, caches the answers, and counts usage', async () => {
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

    const outcome = await solveRun(runId, SETTINGS, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toEqual({ ok: true, requestsMade: 1 })
    expect(script.calls).toHaveLength(1)
    expect(script.calls[0].modelId).toBe('gemini-3.5-flash')
    expect(script.calls[0].prompt.startsWith('You are answering multiple-choice')).toBe(true)
    // Only the two blank rows were sent.
    expect(script.calls[0].prompt).toContain('Question 2?')
    expect(script.calls[0].prompt).not.toContain('Question 1?')
    const cached = await readAiAnswers(runId)
    expect(cached?.answers).toEqual({
      '2': { index: 1, confidence: 'certain' },
      '3': { index: null, confidence: 'unsure' },
    })
    expect((await getRun(runId))?.requestCount).toBe(1)
  })

  it('attaches the chunk rows’ figure crops', async () => {
    const runId = await seedRun([row('1', { image_urls: ['images/q1.jpg'] })])
    await putArtifact({
      runId,
      kind: 'crop',
      path: 'images/q1.jpg',
      bytes: new Uint8Array([9, 9]),
    })
    const script = scriptedAdapter()
    script.push(ok(answersJson([{ id: '1', index: 0, confidence: 'likely' }])))

    await solveRun(runId, SETTINGS, {
      controller: new GeminiController(script.adapter),
    })

    expect(script.calls[0].imageCount).toBe(1)
  })

  it('one repair retry on invalid content; still invalid → honest unsure', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()
    script.push(
      ok('not json at all'),
      ok(answersJson([{ id: 'foreign', index: 0, confidence: 'certain' }])),
    )

    const outcome = await solveRun(runId, SETTINGS, {
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

  it('cached answers are never re-asked; clearing them re-solves', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()
    script.push(ok(answersJson([{ id: '1', index: 2, confidence: 'certain' }])))
    const controller = new GeminiController(script.adapter)

    await solveRun(runId, SETTINGS, { controller })
    const again = await solveRun(runId, SETTINGS, { controller })

    expect(again).toEqual({ ok: true, requestsMade: 0 })
    expect(script.calls).toHaveLength(1)

    await clearAiAnswers(runId)
    script.push(ok(answersJson([{ id: '1', index: 0, confidence: 'likely' }])))
    await solveRun(runId, SETTINGS, { controller })
    expect(script.calls).toHaveLength(2)
    expect((await readAiAnswers(runId))?.answers['1']).toEqual({
      index: 0,
      confidence: 'likely',
    })
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

    const outcome = await solveRun(runId, SETTINGS, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.kind).toBe('wrong-key')
    // The first chunk's ten answers survived the stop.
    expect(Object.keys((await readAiAnswers(runId))?.answers ?? {})).toHaveLength(10)
  })

  it('an overloaded primary model falls back to flash-lite for the chunk', async () => {
    const runId = await seedRun([row('1')])
    const script = scriptedAdapter()
    const overloaded: VisionResult = {
      ok: false,
      kind: 'provider-error',
      code: 'temporarily-unavailable',
      httpStatus: 503,
      retryAfterSeconds: 0,
    }
    // Controller's own transient retries (initial + 3) on the primary…
    script.push(overloaded, overloaded, overloaded, overloaded)
    // …then the fallback model answers.
    script.push(ok(answersJson([{ id: '1', index: 1, confidence: 'certain' }])))

    const outcome = await solveRun(runId, SETTINGS, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.ok).toBe(true)
    expect(script.calls.at(-1)?.modelId).toBe('gemini-3.1-flash-lite')
    expect((await readAiAnswers(runId))?.answers['1']).toEqual({
      index: 1,
      confidence: 'certain',
    })
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

describe('applyAiAnswers', () => {
  const artifact = (
    answers: AiAnswersArtifact['answers'],
  ): AiAnswersArtifact => ({ answers, solvedAt: 1 })

  const blank = row('b')
  const answered = row('a', { correct_index: '1', needs_review: '' })

  it('fills accepted answers on blank rows and flags provenance', () => {
    const [applied] = applyAiAnswers(
      [blank],
      artifact({ b: { index: 2, confidence: 'certain' } }),
      { scope: 'unanswered', flagBelow: 'certain' },
    )
    expect(applied.correct_index).toBe('2')
    expect(applied.needs_review).toBe('ai_answered')
  })

  it('below-threshold answers stay blank and read ai_unsure', () => {
    const [applied] = applyAiAnswers(
      [blank],
      artifact({ b: { index: 2, confidence: 'likely' } }),
      { scope: 'unanswered', flagBelow: 'certain' },
    )
    expect(applied.correct_index).toBe('')
    expect(applied.needs_review).toBe('ai_unsure')
  })

  it('flagBelow relaxes the threshold', () => {
    const likely = artifact({ b: { index: 2, confidence: 'likely' } })
    expect(
      applyAiAnswers([blank], likely, { scope: 'unanswered', flagBelow: 'likely' })[0]
        .correct_index,
    ).toBe('2')
    const unsureWithIndex = artifact({ b: { index: 1, confidence: 'unsure' } })
    expect(
      applyAiAnswers([blank], unsureWithIndex, { scope: 'unanswered', flagBelow: 'never' })[0]
        .correct_index,
    ).toBe('1')
  })

  it('a null index never fills, whatever the threshold', () => {
    const [applied] = applyAiAnswers(
      [blank],
      artifact({ b: { index: null, confidence: 'certain' } }),
      { scope: 'unanswered', flagBelow: 'never' },
    )
    expect(applied.correct_index).toBe('')
    expect(applied.needs_review).toBe('ai_unsure')
  })

  it('verify mode flags disagreements but never overrides the document', () => {
    const [applied] = applyAiAnswers(
      [answered],
      artifact({ a: { index: 2, confidence: 'certain' } }),
      { scope: 'unanswered+verify', flagBelow: 'certain' },
    )
    expect(applied.correct_index).toBe('1')
    expect(applied.needs_review).toBe('ai_disagrees')

    const [agreeing] = applyAiAnswers(
      [answered],
      artifact({ a: { index: 1, confidence: 'certain' } }),
      { scope: 'unanswered+verify', flagBelow: 'certain' },
    )
    expect(agreeing.needs_review).toBe('')
  })

  it('scope all overrides document answers with accepted AI answers', () => {
    const [applied] = applyAiAnswers(
      [answered],
      artifact({ a: { index: 2, confidence: 'certain' } }),
      { scope: 'all', flagBelow: 'certain' },
    )
    expect(applied.correct_index).toBe('2')
    expect(applied.needs_review).toBe('ai_answered')
  })

  it('rows without an AI entry are returned untouched', () => {
    const [applied] = applyAiAnswers([blank], artifact({}), {
      scope: 'unanswered',
      flagBelow: 'never',
    })
    expect(applied).toEqual(blank)
  })

  it('an out-of-range cached index is treated as no answer', () => {
    const [applied] = applyAiAnswers(
      [blank],
      artifact({ b: { index: 99, confidence: 'certain' } }),
      { scope: 'unanswered', flagBelow: 'certain' },
    )
    expect(applied.correct_index).toBe('')
    expect(applied.needs_review).toBe('ai_unsure')
  })
})

describe('pendingRows', () => {
  it('subtracts cached answers from the scope’s targets', () => {
    const rows = [row('1'), row('2', { correct_index: '0', needs_review: '' })]
    const cached: AiAnswersArtifact = {
      answers: { '1': { index: 0, confidence: 'certain' } },
      solvedAt: 1,
    }
    expect(pendingRows(rows, 'unanswered', cached)).toHaveLength(0)
    expect(pendingRows(rows, 'unanswered', undefined)).toHaveLength(1)
    expect(pendingRows(rows, 'all', cached).map((r) => r.id)).toEqual(['2'])
  })
})
