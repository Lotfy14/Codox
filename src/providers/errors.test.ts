import { describe, expect, it } from 'vitest'
import {
  classifyGeminiFetchError,
  classifyGeminiHttpFailure,
  parseGeminiErrorBody,
  parseRetryAfterHeader,
} from './errors'

/** Real invalid-key body measured live against Gemini on 2026-07-11. */
const invalidKeyBody = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_INVALID',
        domain: 'googleapis.com',
        metadata: { service: 'generativelanguage.googleapis.com' },
      },
    ],
  },
}

/** 429 shape documented in ai.google.dev troubleshooting + real reports. */
function quotaBody(quotaId: string, retryDelay?: string) {
  return {
    error: {
      code: 429,
      message: "You've exceeded one of the API's rate limits.",
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId }],
        },
        ...(retryDelay === undefined
          ? []
          : [
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay,
              },
            ]),
      ],
    },
  }
}

describe('parseGeminiErrorBody', () => {
  it('extracts status, reason, quota ids, and retry delay', () => {
    const parsed = parseGeminiErrorBody(
      quotaBody('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '55s'),
    )
    expect(parsed.status).toBe('RESOURCE_EXHAUSTED')
    expect(parsed.quotaIds).toEqual([
      'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
    ])
    expect(parsed.retryDelaySeconds).toBe(55)
  })

  it('extracts the API_KEY_INVALID reason', () => {
    expect(parseGeminiErrorBody(invalidKeyBody).reason).toBe('API_KEY_INVALID')
  })

  it('tolerates malformed bodies', () => {
    for (const body of [undefined, null, 'nope', 42, {}, { error: 'x' }]) {
      expect(parseGeminiErrorBody(body).quotaIds).toEqual([])
    }
  })
})

describe('classifyGeminiHttpFailure', () => {
  it('maps 400 + API_KEY_INVALID to wrong-key (the measured bad-key shape)', () => {
    const failure = classifyGeminiHttpFailure(
      400,
      parseGeminiErrorBody(invalidKeyBody),
    )
    expect(failure.kind).toBe('wrong-key')
    expect(failure.code).toBeUndefined()
  })

  it('maps plain 400 without the key reason to provider-error, never wrong-key', () => {
    const failure = classifyGeminiHttpFailure(400, parseGeminiErrorBody({}))
    expect(failure.kind).toBe('provider-error')
    expect(failure.code).toBe('invalid-request')
  })

  it('keeps Gemini billing/setup failures actionable without storing response text', () => {
    const failure = classifyGeminiHttpFailure(
      400,
      parseGeminiErrorBody({ error: { status: 'FAILED_PRECONDITION' } }),
    )
    expect(failure).toMatchObject({
      kind: 'provider-error',
      code: 'billing-required',
      httpStatus: 400,
    })
  })

  it('identifies unavailable models and transient provider failures', () => {
    expect(
      classifyGeminiHttpFailure(404, parseGeminiErrorBody({})).code,
    ).toBe('model-unavailable')
    expect(
      classifyGeminiHttpFailure(503, parseGeminiErrorBody({})).code,
    ).toBe('temporarily-unavailable')
  })

  it('maps 401 and 403 to wrong-key', () => {
    expect(classifyGeminiHttpFailure(401, parseGeminiErrorBody({})).kind).toBe(
      'wrong-key',
    )
    expect(classifyGeminiHttpFailure(403, parseGeminiErrorBody({})).kind).toBe(
      'wrong-key',
    )
  })

  it('maps 429 with a PerDay quota violation to quota-exhausted', () => {
    const failure = classifyGeminiHttpFailure(
      429,
      parseGeminiErrorBody(
        quotaBody('GenerateRequestsPerDayPerProjectPerModel-FreeTier'),
      ),
    )
    expect(failure.kind).toBe('quota-exhausted')
  })

  it('maps 429 with a PerMinute quota violation to rate-limited, carrying retryDelay', () => {
    const failure = classifyGeminiHttpFailure(
      429,
      parseGeminiErrorBody(
        quotaBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '17s'),
      ),
    )
    expect(failure.kind).toBe('rate-limited')
    expect(failure.retryAfterSeconds).toBe(17)
  })

  it('maps a bare 429 with no details to rate-limited, not quota-exhausted', () => {
    const failure = classifyGeminiHttpFailure(429, parseGeminiErrorBody({}))
    expect(failure.kind).toBe('rate-limited')
  })

  it('maps 5xx to provider-error', () => {
    for (const status of [500, 502, 503]) {
      expect(
        classifyGeminiHttpFailure(status, parseGeminiErrorBody({})).kind,
      ).toBe('provider-error')
    }
  })

  it('falls back to the Retry-After header when RetryInfo is absent', () => {
    const failure = classifyGeminiHttpFailure(429, parseGeminiErrorBody({}), 30)
    expect(failure.retryAfterSeconds).toBe(30)
  })
})

describe('classifyGeminiFetchError', () => {
  it('maps AbortError to aborted', () => {
    const failure = classifyGeminiFetchError(
      new DOMException('The user aborted a request.', 'AbortError'),
      true,
    )
    expect(failure.kind).toBe('aborted')
  })

  it('maps TimeoutError to unreachable (retryable), never aborted', () => {
    const failure = classifyGeminiFetchError(
      new DOMException('signal timed out', 'TimeoutError'),
      true,
    )
    expect(failure.kind).toBe('unreachable')
  })

  it('maps network TypeError to unreachable, flagging offline devices', () => {
    const online = classifyGeminiFetchError(new TypeError('failed'), true)
    expect(online.kind).toBe('unreachable')
    expect(online.offline).toBe(false)

    const offline = classifyGeminiFetchError(new TypeError('failed'), false)
    expect(offline.kind).toBe('unreachable')
    expect(offline.offline).toBe(true)
  })

  it('maps anything unknown to provider-error, never wrong-key', () => {
    expect(classifyGeminiFetchError(new Error('?'), true).kind).toBe(
      'provider-error',
    )
  })
})

describe('parseRetryAfterHeader', () => {
  it('parses delta-seconds and rejects garbage', () => {
    expect(parseRetryAfterHeader('30')).toBe(30)
    expect(parseRetryAfterHeader(null)).toBeUndefined()
    expect(parseRetryAfterHeader('Wed, 21 Oct 2026')).toBeUndefined()
    expect(parseRetryAfterHeader('-5')).toBeUndefined()
  })
})
