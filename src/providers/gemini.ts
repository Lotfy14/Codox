import {
  classifyGeminiFetchError,
  classifyGeminiHttpFailure,
  parseGeminiErrorBody,
  parseRetryAfterHeader,
} from './errors'
import type {
  GeminiAdapter,
  KeyCheckResult,
  ModelListResult,
  ProbeResult,
  ProviderFailure,
  VisionRequest,
  VisionResult,
  VisionUsage,
} from './types'

/**
 * The one Gemini adapter. It moves bytes: no prompts, no engine-output
 * formatting, no retries, no fallback keys. The API key travels only in the
 * `x-goog-api-key` header — never in a URL, log line, or error object.
 *
 * Endpoint facts verified live 2026-07-11 against the real Gemini API;
 * re-verify against current Google docs before trusting them for new work.
 */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Default free-tier vision-capable model. The Phase-2 spike round-tripped
 * `gemini-3.5-flash` from both installed shells on 2026-07-11.
 */
export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.5-flash'

/**
 * Cheap, stable model used only to prove that a key can generate content.
 * Keep this independent from the stronger models used for conversions: a
 * manual key check should spend as little quota as possible.
 */
export const GEMINI_KEY_CHECK_MODEL = 'gemini-2.5-flash-lite'

function keyHeaders(key: string): HeadersInit {
  return { 'x-goog-api-key': key }
}

/** Cheap GET endpoints answer in seconds; generation carries page uploads. */
const LIST_TIMEOUT_MS = 30_000
const GENERATE_TIMEOUT_MS = 300_000
const KEY_CHECK_TIMEOUT_MS = 60_000

/**
 * A fetch with no deadline can stall forever and freeze a run mid-step
 * (the stuck-at-20% bug). Every request gets one; the timeout abort maps
 * to `unreachable`, so the controller pauses and retries instead of
 * hanging.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new DOMException('Gemini request timed out', 'TimeoutError')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

/**
 * `GET /models` costs no generation quota and returns 400 API_KEY_INVALID
 * for a bad key, which makes it a cheap startup reachability/authentication
 * probe. The manual key check below additionally proves generation access.
 */
async function listModels(
  key: string,
  onLine: () => boolean,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  let response: Response
  try {
    response = await fetchWithTimeout(
      `${GEMINI_BASE_URL}/models?pageSize=1`,
      { headers: keyHeaders(key) },
      LIST_TIMEOUT_MS,
      signal,
    )
  } catch (error) {
    return classifyGeminiFetchError(error, onLine())
  }
  if (response.ok) return { ok: true }
  return classifyHttpError(response)
}

async function classifyHttpError(response: Response): Promise<ProviderFailure> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return classifyGeminiHttpFailure(
    response.status,
    parseGeminiErrorBody(body),
    parseRetryAfterHeader(response.headers.get('retry-after')),
  )
}

/**
 * A successful model listing proves authentication, but not that this key can
 * generate content. The manual Check key action therefore makes the smallest
 * real generation request we can make with the dedicated low-cost check model.
 */
async function validateGeneration(
  key: string,
  onLine: () => boolean,
  signal?: AbortSignal,
): Promise<KeyCheckResult> {
  let response: Response
  try {
    response = await fetchWithTimeout(
      `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_KEY_CHECK_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          ...keyHeaders(key),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 },
        }),
      },
      KEY_CHECK_TIMEOUT_MS,
      signal,
    )
  } catch (error) {
    return classifyGeminiFetchError(error, onLine())
  }
  return response.ok ? { ok: true } : classifyHttpError(response)
}

/** Extracts the first candidate's concatenated text parts. */
function extractText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const candidates = (body as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return ''
  const content = (candidates[0] as { content?: { parts?: unknown } }).content
  if (!Array.isArray(content?.parts)) return ''
  return content.parts
    .map((part: unknown) =>
      typeof (part as { text?: unknown })?.text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('')
}

/** The first candidate's `finishReason`, verbatim, when present. */
function extractFinishReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const candidates = (body as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined
  const reason = (candidates[0] as { finishReason?: unknown }).finishReason
  return typeof reason === 'string' ? reason : undefined
}

/** Token counts from `usageMetadata`, when the response carried them. */
function extractUsage(body: unknown): VisionUsage | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const meta = (body as { usageMetadata?: unknown }).usageMetadata
  if (typeof meta !== 'object' || meta === null) return undefined
  const read = (field: string): number | undefined => {
    const value = (meta as Record<string, unknown>)[field]
    return typeof value === 'number' ? value : undefined
  }
  const usage: VisionUsage = {
    promptTokens: read('promptTokenCount'),
    candidatesTokens: read('candidatesTokenCount'),
    totalTokens: read('totalTokenCount'),
  }
  return usage.promptTokens === undefined &&
    usage.candidatesTokens === undefined &&
    usage.totalTokens === undefined
    ? undefined
    : usage
}

export function createGeminiAdapter(
  onLine: () => boolean = () => navigator.onLine,
): GeminiAdapter {
  return {
    id: 'gemini',
    name: 'Google Gemini',

    async probe(key: string, signal?: AbortSignal): Promise<ProbeResult> {
      return listModels(key, onLine, signal)
    },

    async validateKey(
      key: string,
      signal?: AbortSignal,
    ): Promise<KeyCheckResult> {
      return validateGeneration(key, onLine, signal)
    },

    async listModels(
      key: string,
      signal?: AbortSignal,
    ): Promise<ModelListResult> {
      let response: Response
      try {
        response = await fetchWithTimeout(
          `${GEMINI_BASE_URL}/models?pageSize=1000`,
          { headers: keyHeaders(key) },
          LIST_TIMEOUT_MS,
          signal,
        )
      } catch (error) {
        return classifyGeminiFetchError(error, onLine())
      }
      if (!response.ok) return classifyHttpError(response)

      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { ok: false, kind: 'provider-error', httpStatus: response.status }
      }
      const models = (body as { models?: unknown }).models
      if (!Array.isArray(models)) {
        return { ok: false, kind: 'provider-error', httpStatus: response.status }
      }
      return {
        ok: true,
        modelIds: models.flatMap((model: unknown) => {
          const name = (model as { name?: unknown }).name
          return typeof name === 'string'
            ? [name.replace(/^models\//, '')]
            : []
        }),
      }
    },

    async complete(
      request: VisionRequest,
      key: string,
      signal?: AbortSignal,
    ): Promise<VisionResult> {
      const model = request.modelId ?? DEFAULT_GEMINI_VISION_MODEL
      let response: Response
      try {
        response = await fetchWithTimeout(
          `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              ...keyHeaders(key),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: request.prompt },
                    ...request.images.map((image) => ({
                      inlineData: {
                        mimeType: image.mimeType,
                        data: image.base64Data,
                      },
                    })),
                  ],
                },
              ],
              ...(request.generationConfig !== undefined
                ? { generationConfig: request.generationConfig }
                : {}),
            }),
          },
          GENERATE_TIMEOUT_MS,
          signal,
        )
      } catch (error) {
        return classifyGeminiFetchError(error, onLine())
      }

      if (!response.ok) return classifyHttpError(response)

      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { ok: false, kind: 'provider-error', httpStatus: response.status }
      }
      return {
        ok: true,
        text: extractText(body),
        finishReason: extractFinishReason(body),
        usage: extractUsage(body),
      }
    },
  }
}

export const geminiAdapter: GeminiAdapter = createGeminiAdapter()
