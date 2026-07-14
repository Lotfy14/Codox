/**
 * The AI answer solver — the opt-in "Export with AI answers" feature
 * (owner-approved sole exception to NEVER-GUESS). Deliberately OUTSIDE the
 * pinned engine path: it runs at export time on a finished run, reads the
 * pristine `merged-rows` artifact, and stores its own answers in a separate
 * `ai-answers` artifact. Engine output is never modified; deterministic
 * code marks every row the AI touches (`ai_answered` / `ai_unsure` /
 * `ai_disagrees`) so provenance survives into the exported CSV.
 */
import type { GeminiController } from '../providers/controller'
import { geminiController } from '../providers/controller'
import type { ProviderFailure, VisionRequest } from '../providers/types'
import type { AiAnswerSettings } from '../state/ai-answers-settings'
import { db } from '../state/db'
import {
  getArtifact,
  getCropByPath,
  putArtifact,
  recordRequestUsage,
} from '../state/runs'
import { bytesToBase64 } from '../providers/base64'
import { applyResolutions, getResolutions } from '../screens/review-data'
import { wasTruncated } from './calls'
import { isRecord, parseModelJson } from './json'
import { SOLVER_PROMPT } from './solver-prompt'
import type { MergedRow } from './types'

export type AiConfidence = 'certain' | 'likely' | 'unsure'

export interface AiAnswer {
  /** 0-based option index, or null when the model would be guessing. */
  index: number | null
  confidence: AiConfidence
}

/** The `ai-answers` artifact: one solved answer per row id, cached. */
export interface AiAnswersArtifact {
  answers: Record<string, AiAnswer>
  solvedAt: number
}

export type SolveOutcome =
  | { ok: true; requestsMade: number }
  | { ok: false; failure: ProviderFailure }

export interface SolveOptions {
  controller?: GeminiController
  signal?: AbortSignal
  /** Rows per Gemini call (worker-style chunking). */
  chunkSize?: number
  onProgress?: (chunksDone: number, chunkCount: number) => void
}

const DEFAULT_CHUNK_SIZE = 10
const SOLVER_MAX_TOKENS = 8_192
export const SOLVER_MODEL = 'gemini-3.1-flash-lite'

// ---------------------------------------------------------------- reading

export async function readAiAnswers(
  runId: string,
): Promise<AiAnswersArtifact | undefined> {
  const artifact = await getArtifact(runId, 'ai-answers')
  const json = artifact?.json
  if (!isRecord(json) || !isRecord(json.answers)) return undefined
  return json as unknown as AiAnswersArtifact
}

/** Drops the cached answers so the next solve re-asks Gemini. */
export async function clearAiAnswers(runId: string): Promise<void> {
  const artifact = await getArtifact(runId, 'ai-answers')
  if (artifact !== undefined) await db.runArtifacts.delete(artifact.id)
}

/** The run's exportable rows with the tutor's confirmed answers applied. */
export async function resolvedRows(runId: string): Promise<MergedRow[]> {
  const merged = await getArtifact(runId, 'merged-rows')
  const rows = (merged?.json as MergedRow[] | undefined) ?? []
  return applyResolutions(rows, await getResolutions(runId))
}

// ---------------------------------------------------------------- scoping

/** The rows the solver targets under a scope. */
export function targetRows(
  rows: readonly MergedRow[],
  scope: AiAnswerSettings['scope'],
): MergedRow[] {
  if (scope === 'unanswered') {
    return rows.filter((row) => row.correct_index === '')
  }
  return [...rows]
}

/** Target rows not yet in the cache — what a solve would actually send. */
export function pendingRows(
  rows: readonly MergedRow[],
  scope: AiAnswerSettings['scope'],
  cached: AiAnswersArtifact | undefined,
): MergedRow[] {
  return targetRows(rows, scope).filter(
    (row) => cached?.answers[row.id] === undefined,
  )
}

/** Gemini request count a solve would make — the dialog's quota note. */
export function estimateSolverRequests(
  pendingRowCount: number,
  chunkSize = DEFAULT_CHUNK_SIZE,
): number {
  return Math.ceil(pendingRowCount / chunkSize)
}

// ---------------------------------------------------------------- calls

function buildSolverRequest(
  rows: readonly MergedRow[],
  images: VisionRequest['images'],
  imagePaths: readonly string[],
  previousError?: string,
): VisionRequest {
  const parts = [
    SOLVER_PROMPT,
    '',
    'QUESTIONS:',
    JSON.stringify({
      rows: rows.map((row) => ({
        id: row.id,
        question: row.question,
        options: row.options,
        image_urls: row.image_urls,
      })),
    }),
  ]
  if (imagePaths.length > 0) {
    parts.push(
      '',
      'ATTACHED IMAGE ORDER:',
      JSON.stringify(imagePaths),
      'The attached cropped images follow this order. Match each path to the question image_urls field.',
    )
  }
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
    images,
    modelId: SOLVER_MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: SOLVER_MAX_TOKENS,
      responseMimeType: 'application/json',
    },
  }
}

/** Chunk rows' referenced figure crops, deduped and attached in listed order. */
async function chunkImages(
  runId: string,
  rows: readonly MergedRow[],
): Promise<{ images: VisionRequest['images']; paths: string[] }> {
  const requestedPaths = [...new Set(rows.flatMap((row) => row.image_urls))]
  const images: Array<{ mimeType: string; base64Data: string }> = []
  const paths: string[] = []
  for (const path of requestedPaths) {
    const crop = await getCropByPath(runId, path)
    if (crop?.bytes === undefined) continue
    paths.push(path)
    images.push({ mimeType: 'image/jpeg', base64Data: bytesToBase64(crop.bytes) })
  }
  return { images, paths }
}

interface ChunkValidation {
  ok: boolean
  answers: Record<string, AiAnswer>
  error?: string
}

/**
 * Deterministic gate on one solver response: ids ⊆ requested, index an
 * integer within that row's option range or null, confidence in-set.
 * The model's formatting is never trusted.
 */
export function validateSolverChunk(
  text: string,
  rows: readonly MergedRow[],
): ChunkValidation {
  const parsed = parseModelJson(text)
  if (parsed.error !== undefined) {
    return { ok: false, answers: {}, error: `response is not JSON: ${parsed.error}` }
  }
  if (!isRecord(parsed.value) || !Array.isArray(parsed.value.answers)) {
    return { ok: false, answers: {}, error: 'missing "answers" array' }
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const answers: Record<string, AiAnswer> = {}
  for (const entry of parsed.value.answers as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      return { ok: false, answers: {}, error: 'an answer is missing its id' }
    }
    const row = byId.get(entry.id)
    if (row === undefined) {
      return { ok: false, answers: {}, error: `unknown row id "${entry.id}"` }
    }
    const confidence = entry.confidence
    if (confidence !== 'certain' && confidence !== 'likely' && confidence !== 'unsure') {
      return { ok: false, answers: {}, error: `row "${entry.id}": invalid confidence` }
    }
    const index = entry.correct_index
    if (index !== null) {
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= row.options.length) {
        return { ok: false, answers: {}, error: `row "${entry.id}": correct_index out of range` }
      }
    }
    answers[entry.id] = { index: index as number | null, confidence }
  }
  const missing = rows.filter((row) => answers[row.id] === undefined)
  if (missing.length > 0) {
    return {
      ok: false,
      answers: {},
      error: `missing answers for ids: ${missing.map((row) => row.id).join(', ')}`,
    }
  }
  return { ok: true, answers }
}

/** Merge one chunk's answers into the cached artifact (update-in-place). */
async function saveAnswers(
  runId: string,
  answers: Record<string, AiAnswer>,
): Promise<void> {
  const artifact = await getArtifact(runId, 'ai-answers')
  if (artifact === undefined) {
    await putArtifact({
      runId,
      kind: 'ai-answers',
      json: { answers, solvedAt: Date.now() } satisfies AiAnswersArtifact,
    })
    return
  }
  const current = (artifact.json as AiAnswersArtifact | undefined)?.answers ?? {}
  await db.runArtifacts.update(artifact.id, {
    json: {
      answers: { ...current, ...answers },
      solvedAt: Date.now(),
    } satisfies AiAnswersArtifact,
  })
}

/**
 * Solves the run's pending target rows in chunks, caching each chunk as it
 * lands (an abort keeps everything already answered). Quota, rate-limit and
 * offline pauses are absorbed by the controller exactly like engine calls.
 * Every request contains formatted question text, includes any referenced
 * image crops, and is pinned to the low-cost solver model.
 */
export async function solveRun(
  runId: string,
  settings: AiAnswerSettings,
  options: SolveOptions = {},
): Promise<SolveOutcome> {
  const controller = options.controller ?? geminiController
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const { signal, onProgress } = options

  const rows = await resolvedRows(runId)
  const pending = pendingRows(rows, settings.scope, await readAiAnswers(runId))
  const chunkCount = Math.ceil(pending.length / chunkSize)
  onProgress?.(0, chunkCount)

  let requestsMade = 0
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkRows = pending.slice(
      chunkIndex * chunkSize,
      (chunkIndex + 1) * chunkSize,
    )
    const attached = await chunkImages(runId, chunkRows)
    let previousError: string | undefined
    let accepted: Record<string, AiAnswer> | undefined
    // Exactly one retry, consumed only by INVALID CONTENT (worker idiom).
    for (let attempt = 0; attempt < 2 && accepted === undefined; attempt += 1) {
      const result = await controller.runGeminiRequest(
        buildSolverRequest(
          chunkRows,
          attached.images,
          attached.paths,
          previousError,
        ),
        { signal },
      )
      if (!result.ok) {
        await recordRequestUsage(runId)
        return { ok: false, failure: result }
      }
      await recordRequestUsage(runId, result.usage)
      requestsMade += 1

      if (wasTruncated(result.finishReason)) {
        previousError = 'your response was truncated; return fewer characters'
        continue
      }
      const validation = validateSolverChunk(result.text, chunkRows)
      if (validation.ok) accepted = validation.answers
      else previousError = validation.error
    }

    // Still invalid after the retry → those rows are honestly "unsure";
    // a malformed response never becomes an answer.
    const answers =
      accepted ??
      Object.fromEntries(
        chunkRows.map((row) => [row.id, { index: null, confidence: 'unsure' } as AiAnswer]),
      )
    await saveAnswers(runId, answers)
    onProgress?.(chunkIndex + 1, chunkCount)
  }

  return { ok: true, requestsMade }
}

// ---------------------------------------------------------------- applying

function acceptedConfidence(
  confidence: AiConfidence,
  flagBelow: AiAnswerSettings['flagBelow'],
): boolean {
  if (flagBelow === 'certain') return confidence === 'certain'
  if (flagBelow === 'likely') return confidence !== 'unsure'
  return true
}

/**
 * Applies saved AI answers to the exportable rows — pure, deterministic,
 * used only by the `ai-answers` export mode:
 * - blank row + accepted answer → filled, flagged `ai_answered`
 * - blank row + AI attempted but not accepted → stays blank, `ai_unsure`
 * - `unanswered+verify`: an accepted AI answer disagreeing with a document
 *   answer keeps the document answer and flags `ai_disagrees`
 * - `all`: accepted AI answers override document answers (`ai_answered`)
 * Rows the AI never touched are returned unchanged.
 */
export function applyAiAnswers(
  rows: readonly MergedRow[],
  aiAnswers: AiAnswersArtifact | undefined,
  settings: AiAnswerSettings,
): MergedRow[] {
  return rows.map((row) => {
    const ai = aiAnswers?.answers[row.id]
    if (ai === undefined) return row

    const validIndex =
      ai.index !== null &&
      Number.isInteger(ai.index) &&
      ai.index >= 0 &&
      ai.index < row.options.length
    const accepted = validIndex && acceptedConfidence(ai.confidence, settings.flagBelow)

    if (row.correct_index === '') {
      if (accepted) {
        return { ...row, correct_index: String(ai.index), needs_review: 'ai_answered' }
      }
      return { ...row, needs_review: 'ai_unsure' }
    }

    if (settings.scope === 'all') {
      if (accepted && String(ai.index) !== row.correct_index) {
        return { ...row, correct_index: String(ai.index), needs_review: 'ai_answered' }
      }
      return row
    }

    if (settings.scope === 'unanswered+verify') {
      if (accepted && String(ai.index) !== row.correct_index) {
        return { ...row, needs_review: 'ai_disagrees' }
      }
      return row
    }

    return row
  })
}
