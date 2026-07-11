import {
  classifyGeminiFetchError,
  classifyGeminiHttpFailure,
  parseGeminiErrorBody,
  parseRetryAfterHeader,
} from './errors'
import type {
  GeminiAdapter,
  KeyCheckResult,
  ProbeResult,
  ProviderFailure,
  VisionRequest,
  VisionResult,
} from './types'

/**
 * The one Gemini adapter. It moves bytes: no prompts, no engine-output
 * formatting, no retries, no fallback keys. The API key travels only in the
 * `x-goog-api-key` header — never in a URL, log line, or error object.
 *
 * Endpoint facts verified live 2026-07-11 (see the Step-1 research table in
 * Docs/PHASE4_PLAN.md before trusting any of these against newer docs).
 */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Default free-tier vision-capable model. The Phase-2 spike round-tripped
 * `gemini-3.5-flash` from both installed shells on 2026-07-11.
 */
export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.5-flash'

function keyHeaders(key: string): HeadersInit {
  return { 'x-goog-api-key': key }
}

/**
 * `GET /models` costs no generation quota and returns 400 API_KEY_INVALID
 * for a bad key, which makes it both the reachability probe and the live
 * key check.
 */
async function listModels(
  key: string,
  onLine: () => boolean,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  let response: Response
  try {
    response = await fetch(`${GEMINI_BASE_URL}/models?pageSize=1`, {
      headers: keyHeaders(key),
      signal,
    })
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
      return listModels(key, onLine, signal)
    },

    async complete(
      request: VisionRequest,
      key: string,
      signal?: AbortSignal,
    ): Promise<VisionResult> {
      const model = request.modelId ?? DEFAULT_GEMINI_VISION_MODEL
      let response: Response
      try {
        response = await fetch(
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
            }),
            signal,
          },
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
      return { ok: true, text: extractText(body) }
    },
  }
}

export const geminiAdapter: GeminiAdapter = createGeminiAdapter()
