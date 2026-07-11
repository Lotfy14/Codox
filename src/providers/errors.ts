import type { ProviderFailure, ProviderFailureKind } from './types'

/**
 * Deterministic mapping from Gemini HTTP/network outcomes to the closed
 * failure taxonomy. Pure functions only — no fetch, no globals except the
 * caller-supplied `onLine` flag — so every bucket is unit-testable offline.
 *
 * Measured facts this encodes (2026-07-11, live against
 * generativelanguage.googleapis.com):
 * - An invalid API key returns HTTP 400 with `error.status:
 *   "INVALID_ARGUMENT"` and an ErrorInfo detail `reason: "API_KEY_INVALID"`
 *   — not 401. Plain 400s without that reason are provider errors.
 * - Quota violations arrive as 429 RESOURCE_EXHAUSTED with QuotaFailure
 *   details whose `quotaId` names the window (…PerDay… vs …PerMinute…) and
 *   an optional RetryInfo `retryDelay` like "17s".
 */

/** The interesting parts of a Gemini error response body. */
export interface ParsedGeminiError {
  /** google.rpc code string, e.g. `RESOURCE_EXHAUSTED`. */
  status?: string
  /** ErrorInfo reason, e.g. `API_KEY_INVALID`. */
  reason?: string
  /** QuotaFailure violation quota ids, e.g. `GenerateRequestsPerDay…`. */
  quotaIds: string[]
  /** RetryInfo retryDelay, converted to seconds. */
  retryDelaySeconds?: number
}

interface GeminiErrorDetail {
  '@type'?: string
  reason?: string
  retryDelay?: string
  violations?: Array<{ quotaId?: string }>
}

/**
 * Extracts status/reason/quota/retry information from a Gemini error body.
 * Tolerates any malformed shape — absent fields simply stay undefined.
 */
export function parseGeminiErrorBody(body: unknown): ParsedGeminiError {
  const parsed: ParsedGeminiError = { quotaIds: [] }
  if (typeof body !== 'object' || body === null) return parsed

  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return parsed

  const { status, details } = error as {
    status?: unknown
    details?: unknown
  }
  if (typeof status === 'string') parsed.status = status
  if (!Array.isArray(details)) return parsed

  for (const rawDetail of details as unknown[]) {
    if (typeof rawDetail !== 'object' || rawDetail === null) continue
    const detail = rawDetail as GeminiErrorDetail
    const type = detail['@type'] ?? ''

    if (type.endsWith('google.rpc.ErrorInfo') && detail.reason !== undefined) {
      parsed.reason = detail.reason
    }
    if (type.endsWith('google.rpc.RetryInfo') && detail.retryDelay !== undefined) {
      const seconds = parseRetryDelay(detail.retryDelay)
      if (seconds !== undefined) parsed.retryDelaySeconds = seconds
    }
    if (type.endsWith('google.rpc.QuotaFailure') && Array.isArray(detail.violations)) {
      for (const violation of detail.violations) {
        if (typeof violation?.quotaId === 'string') {
          parsed.quotaIds.push(violation.quotaId)
        }
      }
    }
  }
  return parsed
}

/** Parses protobuf Duration strings like `"17s"` or `"3.5s"`. */
function parseRetryDelay(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim())
  if (match === null) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? seconds : undefined
}

/** True when any quota violation names a per-day window. */
function isDailyQuota(parsed: ParsedGeminiError): boolean {
  return parsed.quotaIds.some((id) => id.toLowerCase().includes('perday'))
}

/**
 * Maps a received HTTP response to a taxonomy bucket.
 *
 * - 400 + API_KEY_INVALID, 401, 403 → `wrong-key`
 * - 429 with a per-day quota violation → `quota-exhausted`
 * - any other 429 → `rate-limited` (ambiguity never claims day-long
 *   exhaustion; a burst limit resolves in seconds)
 * - 5xx and anything unrecognized → `provider-error`, never `wrong-key`
 */
export function classifyGeminiHttpFailure(
  httpStatus: number,
  parsed: ParsedGeminiError,
  retryAfterHeaderSeconds?: number,
): ProviderFailure {
  const retryAfterSeconds = parsed.retryDelaySeconds ?? retryAfterHeaderSeconds

  let kind: ProviderFailureKind
  if (httpStatus === 401 || httpStatus === 403) {
    kind = 'wrong-key'
  } else if (httpStatus === 400 && parsed.reason === 'API_KEY_INVALID') {
    kind = 'wrong-key'
  } else if (httpStatus === 429) {
    kind = isDailyQuota(parsed) ? 'quota-exhausted' : 'rate-limited'
  } else {
    kind = 'provider-error'
  }

  return { ok: false, kind, httpStatus, retryAfterSeconds }
}

/**
 * Maps a thrown fetch error (no HTTP response at all) to a bucket.
 * `onLine` comes from `navigator.onLine` at the call site so this stays
 * pure: offline devices read "you are offline", online ones "can't reach".
 */
export function classifyGeminiFetchError(
  error: unknown,
  onLine: boolean,
): ProviderFailure {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { ok: false, kind: 'aborted' }
  }
  // fetch network/CORS failures surface as TypeError in every engine.
  if (error instanceof TypeError) {
    return { ok: false, kind: 'unreachable', offline: !onLine }
  }
  return { ok: false, kind: 'provider-error' }
}

/** Parses a Retry-After header (delta-seconds form only). */
export function parseRetryAfterHeader(
  value: string | null,
): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}
