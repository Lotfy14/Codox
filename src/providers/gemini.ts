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
 * Default (primary) free-tier vision-capable model.
 *
 * Owner decision (2026-07-22): every role now runs `gemini-3.5-flash-lite`,
 * Google's newer Flash-Lite (GA, generativelanguage v1beta — model id verified
 * against the live docs 2026-07-22). It supersedes the 2026-07-14 pin on
 * `gemini-3.1-flash-lite`, which is retained as the runtime FALLBACK below.
 * Accepted-but-unverified cost: crop quality on the new model is unmeasured, so
 * re-run the gold gate (CodoxSandbox) before treating this as permanent.
 */
export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.5-flash-lite'

/**
 * The known-good fallback model. When the primary model cannot answer a
 * request — a missing/billing-gated model, a per-minute rate limit, a
 * provider hiccup, or a persistently empty body — the controller retries the
 * SAME request on this model (owner-approved runtime-fallback exception,
 * 2026-07-22; see controller.ts). It is the previous default, proven on the
 * free tier, so a key that cannot run the new primary still converts.
 */
export const FALLBACK_GEMINI_VISION_MODEL = 'gemini-3.1-flash-lite'

/**
 * Cheap model used only to prove that a key can generate content. It is the
 * FALLBACK model — the guaranteed-runnable path — so a passing check means the
 * key can run a real conversion even if it has no access to the new primary
 * (the engine simply degrades to this model). Keeping the check off the
 * primary avoids a false "setup required" for keys the app would happily serve
 * via the fallback.
 * (The older check model, gemini-2.5-flash-lite, is deprecated and now
 * rejects newer free-tier keys with a billing error — a false negative.)
 */
export const GEMINI_KEY_CHECK_MODEL = FALLBACK_GEMINI_VISION_MODEL

/**
 * The two models a tutor may assign to an engine role in Customize (Advanced —
 * owner-approved 2026-07-22). Whichever model is NOT chosen as a role's primary
 * becomes that role's runtime fallback ("the other one is the fallback"), so
 * the pair is closed at two. Selection is per role; the default leaves every
 * role on the primary with the older model as fallback — byte-identical to the
 * pre-selection behavior. This does not touch the provider/quota rule: both
 * models run under the same one user key; it is a second model, never a second
 * key or provider.
 */
export const SELECTABLE_ENGINE_MODELS = [
  DEFAULT_GEMINI_VISION_MODEL,
  FALLBACK_GEMINI_VISION_MODEL,
] as const

export type EngineModel = (typeof SELECTABLE_ENGINE_MODELS)[number]

/**
 * The other of the two selectable models — a role's fallback is "the one you
 * didn't pick." Any model outside the pair (only the two above are ever passed
 * for an engine role) maps to the known-good fallback, never to itself, so a
 * fallback is always genuinely a different model.
 */
export function otherEngineModel(model: string): EngineModel {
  return model === DEFAULT_GEMINI_VISION_MODEL
    ? FALLBACK_GEMINI_VISION_MODEL
    : DEFAULT_GEMINI_VISION_MODEL
}

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
                    ...request.images.flatMap((image, index) => [
                      { text: `\nIMAGE ${index + 1}:\n` },
                      {
                        inlineData: {
                          mimeType: image.mimeType,
                          data: image.base64Data,
                        },
                      },
                    ]),
                  ],
                },
              ],
              safetySettings: [
                {
                  category: 'HARM_CATEGORY_HARASSMENT',
                  threshold: 'BLOCK_NONE',
                },
                {
                  category: 'HARM_CATEGORY_HATE_SPEECH',
                  threshold: 'BLOCK_NONE',
                },
                {
                  category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                  threshold: 'BLOCK_NONE',
                },
                {
                  category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                  threshold: 'BLOCK_NONE',
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
