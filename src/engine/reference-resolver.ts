import type { VisionRequest } from '../providers/types'
import type { GeminiController } from '../providers/controller'
import type { MergedRow } from './types'
import { REFERENCE_RESOLVER_PROMPT } from './prompts'
import { recordRequestUsage } from '../state/runs'
import { parseModelJson, isRecord } from './json'
import { logEvent } from '../state/diagnostics'

const REFERENCE_KEYWORDS = /\b(question\s+\d+|q\d+|q\s+\d+|previous\s+question|above\s+question)\b/i

function buildResolveRequest(
  rows: readonly MergedRow[],
  previousError?: string,
): VisionRequest {
  const parts = [
    REFERENCE_RESOLVER_PROMPT,
    '',
    'QUESTIONS:',
    JSON.stringify({
      rows: rows.map((row) => ({
        id: row.id,
        question: row.question,
      })),
    }),
  ]
  if (previousError !== undefined) {
    parts.push(
      '',
      'Your previous response failed validation with this error. Return a',
      'corrected response in the same JSON shape.',
      '',
      `VALIDATION ERROR: ${previousError}`,
    )
  }
  return {
    prompt: parts.join('\n'),
    images: [],
    modelId: 'gemini-3.5-flash-lite',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 32768,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                question: { type: 'STRING' },
              },
              required: ['id', 'question'],
            },
          },
        },
        required: ['questions'],
      },
    },
  }
}

function validateResolverResponse(
  text: string,
  rows: readonly MergedRow[],
): { ok: true; questions: Record<string, string> } | { ok: false; error: string } {
  const parsed = parseModelJson(text)
  if (parsed.error !== undefined) {
    return { ok: false, error: `response is not JSON: ${parsed.error}` }
  }
  if (!isRecord(parsed.value) || !Array.isArray(parsed.value.questions)) {
    return { ok: false, error: 'missing "questions" array' }
  }
  const rowIds = new Set(rows.map((row) => row.id))
  const questions: Record<string, string> = {}
  for (const entry of parsed.value.questions as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.question !== 'string') {
      return { ok: false, error: 'a question entry is malformed' }
    }
    if (!rowIds.has(entry.id)) {
      return { ok: false, error: `unknown row id "${entry.id}"` }
    }
    questions[entry.id] = entry.question
  }
  return { ok: true, questions }
}

export async function resolveQuestionReferences(
  rows: MergedRow[],
  controller: GeminiController,
  runId: string,
  signal?: AbortSignal,
): Promise<MergedRow[]> {
  // Guard: Only run reference resolver if we suspect there are cross-question references
  const hasPossibleReferences = rows.some((row) => REFERENCE_KEYWORDS.test(row.question))
  if (!hasPossibleReferences) {
    return rows
  }

  await logEvent({
    scope: 'engine',
    level: 'info',
    event: 'engine.reference_resolver.start',
    runId,
  })

  let previousError: string | undefined
  let accepted: Record<string, string> | undefined

  // Try up to 2 times (exactly one retry)
  for (let attempt = 0; attempt < 2 && accepted === undefined; attempt += 1) {
    const result = await controller.runGeminiRequest(
      buildResolveRequest(rows, previousError),
      { signal },
    )
    if (!result.ok) {
      await recordRequestUsage(runId)
      await logEvent({
        scope: 'engine',
        level: 'warn',
        event: 'engine.reference_resolver.failed_call',
        runId,
        reason: result.kind,
      })
      // Fallback to original rows if LLM call fails
      return rows
    }
    await recordRequestUsage(runId, result.usage)

    const validation = validateResolverResponse(result.text, rows)
    if (validation.ok) {
      accepted = validation.questions
    } else {
      previousError = validation.error
      await logEvent({
        scope: 'engine',
        level: 'warn',
        event: 'engine.reference_resolver.invalid_response',
        runId,
        reason: validation.error,
      })
    }
  }

  if (accepted === undefined) {
    // If both attempts failed validation, return original rows
    return rows
  }

  // Apply resolved questions
  const resolved = rows.map((row) => {
    const updatedQuestion = accepted?.[row.id]
    if (updatedQuestion !== undefined && updatedQuestion.trim() !== '') {
      return {
        ...row,
        question: updatedQuestion,
      }
    }
    return row
  })

  await logEvent({
    scope: 'engine',
    level: 'info',
    event: 'engine.reference_resolver.done',
    runId,
  })

  return resolved
}
