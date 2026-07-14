import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGeminiAdapter,
  DEFAULT_GEMINI_VISION_MODEL,
  GEMINI_KEY_CHECK_MODEL,
} from './gemini'
import { blobToBase64, bytesToBase64 } from './base64'
import type { VisionRequest } from './types'

/**
 * Adapter byte-mover checks for the Phase-6 engine fields: generationConfig
 * goes out verbatim, finishReason and usageMetadata come back verbatim, and
 * the key still travels only in the header.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const geminiBody = {
  candidates: [
    {
      content: { parts: [{ text: '{"rows":[]}' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 1200,
    candidatesTokenCount: 34,
    totalTokenCount: 1234,
  },
}

const request: VisionRequest = {
  prompt: 'planner prompt',
  images: [{ mimeType: 'image/jpeg', base64Data: 'aGVsbG8=' }],
  generationConfig: {
    temperature: 0,
    maxOutputTokens: 65536,
    responseMimeType: 'application/json',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generationConfig passthrough', () => {
  it('sends generationConfig verbatim in the request body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(geminiBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = createGeminiAdapter(() => true)

    await adapter.complete(request, 'k')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    const body = JSON.parse(init.body as string)
    expect(body.generationConfig).toEqual({
      temperature: 0,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    })
    // Key discipline unchanged: header only, never the URL or body.
    expect(url).not.toContain('k=')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(init.body as string).not.toContain('"k"')
  })

  it('omits generationConfig from the body entirely when not provided', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(geminiBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = createGeminiAdapter(() => true)

    await adapter.complete({ prompt: 'p', images: [] }, 'k')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty(
      'generationConfig',
    )
  })
})

describe('live key validation', () => {
  it('uses only the dedicated 3.1 Flash-Lite check model', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(geminiBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = createGeminiAdapter(() => true)

    const result = await adapter.validateKey('checked-key')

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(GEMINI_KEY_CHECK_MODEL).toBe('gemini-3.1-flash-lite')
    // The check now runs the same model every engine role runs, so a passing
    // check proves the key can actually run a conversion.
    expect(GEMINI_KEY_CHECK_MODEL).toBe(DEFAULT_GEMINI_VISION_MODEL)
    expect(url).toContain('gemini-3.1-flash-lite:generateContent')
    expect(url).not.toContain('gemini-3.5-flash')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'checked-key',
    )
    expect(JSON.parse(init.body as string)).toMatchObject({
      contents: [{ parts: [{ text: 'Reply with OK.' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    })
    expect(init.body as string).not.toContain('checked-key')
  })

  it('does not report working when generation access is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { status: 'FAILED_PRECONDITION' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const adapter = createGeminiAdapter(() => true)

    expect(await adapter.validateKey('needs-setup')).toMatchObject({
      ok: false,
      kind: 'provider-error',
      code: 'billing-required',
    })
  })
})

describe('finishReason and usage extraction', () => {
  it('reports the first candidate finishReason and token counts verbatim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiBody)))
    const adapter = createGeminiAdapter(() => true)

    const result = await adapter.complete(request, 'k')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('{"rows":[]}')
      expect(result.finishReason).toBe('STOP')
      expect(result.usage).toEqual({
        promptTokens: 1200,
        candidatesTokens: 34,
        totalTokens: 1234,
      })
    }
  })

  it('surfaces MAX_TOKENS so engine gates can fail on truncation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: '{"truncat' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }),
      ),
    )
    const adapter = createGeminiAdapter(() => true)

    const result = await adapter.complete(request, 'k')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.finishReason).toBe('MAX_TOKENS')
      expect(result.usage).toBeUndefined()
    }
  })

  it('leaves finishReason and usage undefined when Gemini omits them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }),
      ),
    )
    const adapter = createGeminiAdapter(() => true)

    const result = await adapter.complete(request, 'k')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.finishReason).toBeUndefined()
      expect(result.usage).toBeUndefined()
    }
  })
})

describe('base64 encoding', () => {
  it('encodes a Blob without a data-URL prefix', async () => {
    const blob = new Blob(['hello codox'], { type: 'image/jpeg' })
    expect(await blobToBase64(blob)).toBe(btoa('hello codox'))
  })

  it('round-trips binary bytes larger than one btoa chunk', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17)
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 256
    }
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) =>
      c.charCodeAt(0),
    )
    expect(decoded).toEqual(bytes)
  })
})
