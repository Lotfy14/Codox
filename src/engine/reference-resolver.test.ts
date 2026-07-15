import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach } from 'vitest'
import { GeminiController } from '../providers/controller'
import type { GeminiAdapter, VisionResult } from '../providers/types'
import { db } from '../state/db'
import { createRun } from '../state/runs'
import { saveGeminiKey } from '../state/credentials'
import { resolveQuestionReferences } from './reference-resolver'
import type { MergedRow } from './types'

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
      return { ok: true, modelIds: ['gemini-3.1-flash-lite'] }
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

describe('resolveQuestionReferences', () => {
  let runId: string

  beforeEach(async () => {
    await db.runs.clear()
    await db.runArtifacts.clear()
    await db.credentials.clear()
    await saveGeminiKey('local-key')
    runId = await createRun({
      jobId: 'test-job',
      pdfId: 'test-pdf',
      fileName: 'test.pdf',
      pageCount: 10,
    })
  })

  it('skips LLM call if no rows match the reference keywords', async () => {
    const script = scriptedAdapter()
    const controller = new GeminiController(script.adapter)

    const rows: MergedRow[] = [
      {
        id: '1',
        group_id: '',
        topic: '',
        subtopic: '',
        year: '2023',
        question: 'Normal question text without references.',
        options: ['A', 'B'],
        correct_index: '0',
        image_urls: [],
        needs_review: '',
      },
    ]

    const result = await resolveQuestionReferences(rows, controller, runId)
    expect(result).toEqual(rows)
    expect(script.calls.length).toBe(0)
  })

  it('calls Gemini and applies resolved references when keywords are present', async () => {
    const script = scriptedAdapter()
    const controller = new GeminiController(script.adapter)

    const rows: MergedRow[] = [
      {
        id: '4',
        group_id: '',
        topic: '',
        subtopic: '',
        year: '2023',
        question: 'A 52-year-old male presents with chest pain.',
        options: ['A', 'B'],
        correct_index: '0',
        image_urls: [],
        needs_review: '',
      },
      {
        id: '5',
        group_id: '',
        topic: '',
        subtopic: '',
        year: '2023',
        question: 'In the patient described in question 4, what is the best next step?',
        options: ['C', 'D'],
        correct_index: '1',
        image_urls: [],
        needs_review: '',
      },
    ]

    script.push({
      ok: true,
      text: JSON.stringify({
        questions: [
          {
            id: '5',
            question: '[Patient context from Question 4: A 52-year-old male presents with chest pain.] In the patient described in question 4, what is the best next step?',
          },
        ],
      }),
      usage: { promptTokens: 100, candidatesTokens: 50, totalTokens: 150 },
    })

    const result = await resolveQuestionReferences(rows, controller, runId)
    expect(script.calls.length).toBe(1)
    expect(result[0].question).toBe('A 52-year-old male presents with chest pain.')
    expect(result[1].question).toBe('[Patient context from Question 4: A 52-year-old male presents with chest pain.] In the patient described in question 4, what is the best next step?')
  })

  it('falls back to original rows if Gemini response fails validation', async () => {
    const script = scriptedAdapter()
    const controller = new GeminiController(script.adapter)

    const rows: MergedRow[] = [
      {
        id: '5',
        group_id: '',
        topic: '',
        subtopic: '',
        year: '2023',
        question: 'In the patient described in question 4, what is the best next step?',
        options: ['C', 'D'],
        correct_index: '1',
        image_urls: [],
        needs_review: '',
      },
    ]

    // Push an invalid JSON response first, then another invalid response (so both attempts fail)
    script.push({
      ok: true,
      text: 'invalid json text',
    })
    script.push({
      ok: true,
      text: '{}',
    })

    const result = await resolveQuestionReferences(rows, controller, runId)
    expect(script.calls.length).toBe(2)
    expect(result).toEqual(rows) // Should return original rows
  })

  it('falls back to original rows if Gemini API call fails', async () => {
    const script = scriptedAdapter()
    const controller = new GeminiController(script.adapter)

    const rows: MergedRow[] = [
      {
        id: '5',
        group_id: '',
        topic: '',
        subtopic: '',
        year: '2023',
        question: 'In the patient described in question 4, what is the best next step?',
        options: ['C', 'D'],
        correct_index: '1',
        image_urls: [],
        needs_review: '',
      },
    ]

    script.push({
      ok: false,
      kind: 'provider-error',
    })

    const result = await resolveQuestionReferences(rows, controller, runId)
    expect(script.calls.length).toBe(1)
    expect(result).toEqual(rows) // Should return original rows
  })
})
