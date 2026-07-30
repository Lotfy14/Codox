import 'fake-indexeddb/auto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../state/db'
import { getGeminiCredential, saveGeminiKey } from '../state/credentials'
import { GeminiController } from './controller'
import type { ControllerEvent } from './controller'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  FALLBACK_GEMINI_VISION_MODEL,
} from './gemini'
import type {
  GeminiAdapter,
  KeyCheckResult,
  ProbeResult,
  VisionResult,
} from './types'

function makeAdapter(overrides: {
  complete?: (
    key: string,
    modelId: string,
  ) => VisionResult | Promise<VisionResult>
  probe?: (key: string) => ProbeResult | Promise<ProbeResult>
  validateKey?: (key: string) => KeyCheckResult | Promise<KeyCheckResult>
}) {
  const keysSeen: string[] = []
  const modelsSeen: string[] = []
  let completeCalls = 0
  const adapter: GeminiAdapter = {
    id: 'gemini',
    name: 'Google Gemini',
    async probe(key) {
      keysSeen.push(key)
      return overrides.probe?.(key) ?? { ok: true }
    },
    async validateKey(key) {
      keysSeen.push(key)
      return overrides.validateKey?.(key) ?? { ok: true }
    },
    async listModels(key) {
      keysSeen.push(key)
      return { ok: true, modelIds: ['gemini-3.5-flash'] }
    },
    async complete(request, key) {
      keysSeen.push(key)
      const model = request.modelId ?? DEFAULT_GEMINI_VISION_MODEL
      modelsSeen.push(model)
      completeCalls += 1
      return overrides.complete?.(key, model) ?? { ok: true, text: 'ok' }
    },
  }
  return {
    adapter,
    keysSeen,
    modelsSeen,
    completeCallCount: () => completeCalls,
    modelCallCount: (modelId: string) =>
      modelsSeen.filter((seen) => seen === modelId).length,
  }
}

const request = { prompt: 'read this page', images: [] }

beforeEach(async () => {
  await db.credentials.clear()
})

describe('key provenance', () => {
  it('every request uses exactly the key from the singleton credential repository', async () => {
    await saveGeminiKey('the-only-local-key')
    const { adapter, keysSeen } = makeAdapter({})
    const controller = new GeminiController(adapter)

    await controller.runGeminiRequest(request)
    await controller.validateStoredKey()
    await controller.refreshStatus()

    expect(keysSeen).toEqual([
      'the-only-local-key',
      'the-only-local-key',
      'the-only-local-key',
    ])
  })

  it('with no stored key, no request reaches the adapter at all', async () => {
    const { adapter, keysSeen, completeCallCount } = makeAdapter({})
    const controller = new GeminiController(adapter)

    const result = await controller.runGeminiRequest(request)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('wrong-key')
    expect(completeCallCount()).toBe(0)
    expect(keysSeen).toEqual([])
    expect(await controller.refreshStatus()).toBe('no-key')
  })

  it('generationConfig and finishReason pass through the controller untouched', async () => {
    await saveGeminiKey('the-only-local-key')
    let seenRequest: unknown
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
        return { ok: true, modelIds: ['gemini-3.5-flash'] }
      },
      async complete(req) {
        seenRequest = req
        return {
          ok: true,
          text: '{}',
          finishReason: 'MAX_TOKENS',
          usage: { totalTokens: 42 },
        }
      },
    }
    const controller = new GeminiController(adapter)

    const engineRequest = {
      prompt: 'planner',
      images: [],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 65536,
        responseMimeType: 'application/json',
      },
    }
    const result = await controller.runGeminiRequest(engineRequest)

    // The controller adds nothing and strips nothing in either direction.
    expect(seenRequest).toBe(engineRequest)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.finishReason).toBe('MAX_TOKENS')
      expect(result.usage).toEqual({ totalTokens: 42 })
    }
  })

  it('the provider layer contains no alternate key source', () => {
    // Fails the moment anyone wires a key in from anywhere but the
    // credential repository: env vars, storage, or key-in-URL.
    const providersDir = join(process.cwd(), 'src', 'providers')
    const sources = readdirSync(providersDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(providersDir, name), 'utf8'))
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).not.toMatch(/import\.meta\.env/)
      expect(source).not.toMatch(/process\.env/)
      expect(source).not.toMatch(/localStorage|sessionStorage/)
      expect(source).not.toMatch(/[?&]key=/)
    }
  })
})

describe('failure handling', () => {
  it('records required billing/model setup separately from a network problem', async () => {
    await saveGeminiKey('setup-key')
    const { adapter } = makeAdapter({
      validateKey: () => ({
        ok: false,
        kind: 'provider-error',
        code: 'billing-required',
        httpStatus: 400,
      }),
    })
    const controller = new GeminiController(adapter)

    await controller.validateStoredKey()

    expect((await getGeminiCredential())?.lastValidation?.status).toBe(
      'setup-required',
    )
  })

  it('a cheap startup probe cannot upgrade setup-required to working', async () => {
    await saveGeminiKey('setup-key')
    await db.credentials.update('gemini', {
      lastValidation: { status: 'setup-required', checkedAt: 1 },
    })
    const { adapter } = makeAdapter({ probe: () => ({ ok: true }) })
    const controller = new GeminiController(adapter)

    expect(await controller.refreshStatus()).toBe('setup-required')
    expect((await getGeminiCredential())?.lastValidation?.status).toBe(
      'setup-required',
    )
  })

  it('wrong-key stops the run: one adapter call, no retry under any credential', async () => {
    await saveGeminiKey('a-bad-key')
    const { adapter, completeCallCount } = makeAdapter({
      complete: () => ({ ok: false, kind: 'wrong-key', httpStatus: 400 }),
    })
    const controller = new GeminiController(adapter)
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('wrong-key')
    expect(completeCallCount()).toBe(1)
    expect(events.map((event) => event.type)).toEqual(['running', 'wrong-key'])
    // The outcome is recorded against the stored credential.
    expect((await getGeminiCredential())?.lastValidation?.status).toBe(
      'wrong-key',
    )
  })

  it('retries transient Gemini failures and then returns the successful response', async () => {
    await saveGeminiKey('working-key')
    let attempt = 0
    const { adapter, completeCallCount } = makeAdapter({
      complete: () => {
        attempt += 1
        return attempt < 3
          ? {
              ok: false,
              kind: 'provider-error',
              code: 'temporarily-unavailable',
              httpStatus: 503,
              retryAfterSeconds: 0,
            }
          : { ok: true, text: 'recovered' }
      },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: true, text: 'recovered' })
    expect(completeCallCount()).toBe(3)
  })

  it('retries an empty completion as transient and returns the recovered text', async () => {
    await saveGeminiKey('working-key')
    let attempt = 0
    const { adapter, completeCallCount } = makeAdapter({
      complete: () => {
        attempt += 1
        return attempt < 3
          ? { ok: true, text: '', finishReason: 'STOP' }
          : { ok: true, text: '{"rows":[]}', finishReason: 'STOP' }
      },
    })
    const controller = new GeminiController(adapter, {
      transientRetryDelaysSeconds: [0, 0, 0],
      minRequestSpacingMs: 0,
    })

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: true, text: '{"rows":[]}' })
    expect(completeCallCount()).toBe(3)
  })

  it('returns an empty completion unchanged after both models exhaust their retries', async () => {
    await saveGeminiKey('working-key')
    const { adapter, completeCallCount, modelCallCount } = makeAdapter({
      complete: () => ({ ok: true, text: '   ', finishReason: 'STOP' }),
    })
    const controller = new GeminiController(adapter, {
      transientRetryDelaysSeconds: [0, 0, 0],
      minRequestSpacingMs: 0,
    })

    const result = await controller.runGeminiRequest(request)

    // Still a success — downstream content validation owns the verdict. The
    // primary retries the empty (4 calls), then the fallback gets its own run.
    expect(result).toMatchObject({ ok: true, text: '   ' })
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(4)
    expect(modelCallCount(FALLBACK_GEMINI_VISION_MODEL)).toBe(4)
    expect(completeCallCount()).toBe(8)
  })

  it('does not retry an abnormal-finish empty on the primary, but falls back to the known-good model', async () => {
    await saveGeminiKey('working-key')
    const { adapter, modelCallCount } = makeAdapter({
      complete: (_key, model) =>
        model === FALLBACK_GEMINI_VISION_MODEL
          ? { ok: true, text: 'rescued', finishReason: 'STOP' }
          : { ok: true, text: '', finishReason: 'SAFETY' },
    })
    const controller = new GeminiController(adapter, {
      transientRetryDelaysSeconds: [0, 0, 0],
      minRequestSpacingMs: 0,
    })

    const result = await controller.runGeminiRequest(request)

    // The abnormal finish is deterministic, so the primary is called exactly
    // once (no transient retry) before the fallback takes over and recovers.
    expect(result).toMatchObject({ ok: true, text: 'rescued' })
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(1)
    expect(modelCallCount(FALLBACK_GEMINI_VISION_MODEL)).toBe(1)
  })

  it('does not retry a rejected request', async () => {
    await saveGeminiKey('working-key')
    const { adapter, completeCallCount } = makeAdapter({
      complete: () => ({
        ok: false,
        kind: 'provider-error',
        code: 'invalid-request',
        httpStatus: 400,
      }),
    })
    const controller = new GeminiController(adapter)

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(completeCallCount()).toBe(1)
  })

  it('a rate-limited primary falls back to the known-good model without pausing', async () => {
    await saveGeminiKey('quota-key')
    const { adapter, modelCallCount } = makeAdapter({
      complete: (_key, model) =>
        model === FALLBACK_GEMINI_VISION_MODEL
          ? { ok: true, text: 'done' }
          : {
              ok: false,
              kind: 'rate-limited',
              retryAfterSeconds: 0,
              httpStatus: 429,
            },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: true, text: 'done' })
    // The per-minute limit sends the request straight to the fallback — no
    // "paused" flash, because the fallback answered immediately.
    expect(events.map((event) => event.type)).toEqual(['running', 'running'])
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(1)
    expect(modelCallCount(FALLBACK_GEMINI_VISION_MODEL)).toBe(1)
  })

  it("honors a request's own fallbackModelId as the retry model", async () => {
    // A tutor picked the older model as this role's primary, so its paired
    // fallback is the newer one — the request carries that pairing and the
    // controller must retry on it, not on the global FALLBACK constant.
    await saveGeminiKey('quota-key')
    const { adapter, modelCallCount } = makeAdapter({
      complete: (_key, model) =>
        model === DEFAULT_GEMINI_VISION_MODEL
          ? { ok: true, text: 'done' }
          : {
              ok: false,
              kind: 'rate-limited',
              retryAfterSeconds: 0,
              httpStatus: 429,
            },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })

    const result = await controller.runGeminiRequest({
      ...request,
      modelId: FALLBACK_GEMINI_VISION_MODEL,
      fallbackModelId: DEFAULT_GEMINI_VISION_MODEL,
    })

    expect(result).toMatchObject({ ok: true, text: 'done' })
    // Primary (the older model) was rate-limited once, then the request's own
    // fallback (the newer model) answered — the pairing was honored.
    expect(modelCallCount(FALLBACK_GEMINI_VISION_MODEL)).toBe(1)
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(1)
  })

  it('a rate-limited fallback still shows the calm paused state, then resumes', async () => {
    await saveGeminiKey('quota-key')
    let fallbackAttempt = 0
    const { adapter } = makeAdapter({
      complete: (_key, model) => {
        if (model !== FALLBACK_GEMINI_VISION_MODEL) {
          return {
            ok: false,
            kind: 'rate-limited',
            retryAfterSeconds: 0,
            httpStatus: 429,
          }
        }
        fallbackAttempt += 1
        return fallbackAttempt === 1
          ? {
              ok: false,
              kind: 'rate-limited',
              retryAfterSeconds: 0,
              httpStatus: 429,
            }
          : { ok: true, text: 'done' }
      },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)

    expect(result.ok).toBe(true)
    // primary (running) → fallback (running) → its 429 pauses → resumes → running
    expect(events.map((event) => event.type)).toEqual([
      'running',
      'running',
      'paused',
      'resumed',
      'running',
    ])
    const paused = events[2]
    if (paused.type === 'paused') {
      expect(paused.reason).toBe('quota')
      expect(paused.resumesAt).toBeTypeOf('number')
    }
  })

  it('a missing primary model is tried once, then skipped for the rest of the session', async () => {
    await saveGeminiKey('working-key')
    const { adapter, modelCallCount } = makeAdapter({
      complete: (_key, model) =>
        model === FALLBACK_GEMINI_VISION_MODEL
          ? { ok: true, text: 'from-fallback' }
          : {
              ok: false,
              kind: 'provider-error',
              code: 'model-unavailable',
              httpStatus: 404,
            },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })

    const first = await controller.runGeminiRequest(request)
    const second = await controller.runGeminiRequest(request)

    expect(first).toMatchObject({ ok: true, text: 'from-fallback' })
    expect(second).toMatchObject({ ok: true, text: 'from-fallback' })
    // The primary is attempted exactly once across both requests; after its
    // model-unavailable failure the breaker routes straight to the fallback.
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(1)
    expect(modelCallCount(FALLBACK_GEMINI_VISION_MODEL)).toBe(2)
  })

  const dailyQuotaFailure = {
    ok: false,
    kind: 'quota-exhausted',
    retryAfterSeconds: 0,
    httpStatus: 429,
  } as const

  it("a primary out of DAILY quota falls back instead of pausing — Gemini's free tier meters per day PER MODEL", async () => {
    await saveGeminiKey('quota-key')
    const { adapter } = makeAdapter({
      complete: (_key, model) =>
        model === FALLBACK_GEMINI_VISION_MODEL
          ? { ok: true, text: 'from-fallback' }
          : dailyQuotaFailure,
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: true, text: 'from-fallback' })
    // No pause: the exhausted model is abandoned, not waited on.
    expect(events.map((event) => event.type)).toEqual(['running', 'running'])
  })

  it('a daily-exhausted primary is demoted on the FIRST strike, so later requests skip it', async () => {
    await saveGeminiKey('quota-key')
    const { adapter, modelCallCount } = makeAdapter({
      complete: (_key, model) =>
        model === FALLBACK_GEMINI_VISION_MODEL
          ? { ok: true, text: 'from-fallback' }
          : dailyQuotaFailure,
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })

    for (let i = 0; i < 4; i += 1) await controller.runGeminiRequest(request)

    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(1)
    expect(modelCallCount(FALLBACK_GEMINI_VISION_MODEL)).toBe(4)
  })

  it('a transient failure takes 3 consecutive strikes to demote, and a success resets the count', async () => {
    await saveGeminiKey('flaky-key')
    let primaryHealthy = false
    const { adapter, modelCallCount } = makeAdapter({
      complete: (_key, model) => {
        if (model === FALLBACK_GEMINI_VISION_MODEL) {
          return { ok: true, text: 'from-fallback' }
        }
        return primaryHealthy
          ? { ok: true, text: 'from-primary' }
          : { ok: false, kind: 'rate-limited', retryAfterSeconds: 0, httpStatus: 429 }
      },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })

    // Two strikes, then a good answer — the streak restarts, no demotion.
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)
    primaryHealthy = true
    await controller.runGeminiRequest(request)
    primaryHealthy = false
    // Three more consecutive strikes now demote it.
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(6)

    // Demoted: the primary slot is skipped from here on.
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)
    expect(modelCallCount(DEFAULT_GEMINI_VISION_MODEL)).toBe(6)
  })

  it('the strict swap: when the stand-in main is demoted too, the model it replaced gets its turn back', async () => {
    await saveGeminiKey('quota-key')
    // Both models hit their daily cap, so each one demotes the other in turn.
    const calls: string[] = []
    const { adapter } = makeAdapter({
      complete: (_key, model) => {
        calls.push(model)
        // Every first touch of a model is a daily 429; the fallback's own
        // retry succeeds so the request can finish and be observed.
        return calls.length <= 2 ? dailyQuotaFailure : { ok: true, text: 'done' }
      },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })

    // Request 1: the primary 429s and is demoted; the fallback then 429s, is
    // demoted itself, and hands the primary slot back to the model it replaced.
    await controller.runGeminiRequest(request)
    expect(calls.slice(0, 2)).toEqual([
      DEFAULT_GEMINI_VISION_MODEL,
      FALLBACK_GEMINI_VISION_MODEL,
    ])

    // Request 2: so the primary is tried first again rather than shut out for
    // the session — the two trade places instead of both being demoted.
    const before = calls.length
    await controller.runGeminiRequest(request)
    expect(calls[before]).toBe(DEFAULT_GEMINI_VISION_MODEL)
  })

  it('both models out of daily quota still ends in the calm paused state, not an error', async () => {
    await saveGeminiKey('quota-key')
    let calls = 0
    const { adapter } = makeAdapter({
      complete: () => {
        calls += 1
        // Primary 429s, fallback 429s once, then recovers on its retry.
        return calls <= 2 ? dailyQuotaFailure : { ok: true, text: 'done' }
      },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)

    expect(result.ok).toBe(true)
    expect(events.map((event) => event.type)).toEqual([
      'running',
      'running',
      'paused',
      'resumed',
      'running',
    ])
    expect(events[2]).toMatchObject({ type: 'paused', reason: 'quota' })
  })

  it('network loss pauses as offline and the online event resumes it without user action', async () => {
    await saveGeminiKey('offline-key')
    let attempt = 0
    const { adapter } = makeAdapter({
      complete: () => {
        attempt += 1
        return attempt === 1
          ? { ok: false, kind: 'unreachable', offline: true }
          : { ok: true, text: 'back' }
      },
    })
    const controller = new GeminiController(adapter, { minRequestSpacingMs: 0 })
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const pending = controller.runGeminiRequest(request)
    // Let the first attempt fail and the pause begin, then reconnect.
    await new Promise((resolve) => setTimeout(resolve, 10))
    window.dispatchEvent(new Event('online'))

    const result = await pending
    expect(result.ok).toBe(true)
    expect(events.map((event) => event.type)).toEqual([
      'running',
      'paused',
      'resumed',
      'running',
    ])
    expect(events[1]).toMatchObject({ type: 'paused', reason: 'offline' })
  })

  it('an abort during a pause ends the run as aborted', async () => {
    await saveGeminiKey('abort-key')
    const { adapter } = makeAdapter({
      complete: () => ({ ok: false, kind: 'unreachable', offline: false }),
    })
    const controller = new GeminiController(adapter)
    const abort = new AbortController()

    const pending = controller.runGeminiRequest(request, {
      signal: abort.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    abort.abort()

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('aborted')
  })

  it('holds the RPM cap: a request past the window limit waits the window out', async () => {
    await saveGeminiKey('paced-key')
    const { adapter, completeCallCount } = makeAdapter({})
    const controller = new GeminiController(adapter, {
      maxRpm: 2,
      rpmWindowMs: 250,
      minRequestSpacingMs: 0,
    })

    const start = Date.now()
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)

    expect(completeCallCount()).toBe(3)
    // The third request cannot start until the first leaves the window.
    expect(Date.now() - start).toBeGreaterThanOrEqual(250)
  })

  it('spaces out request starts even when the window has room', async () => {
    await saveGeminiKey('paced-key')
    const { adapter, completeCallCount } = makeAdapter({})
    const controller = new GeminiController(adapter, {
      maxRpm: 10,
      rpmWindowMs: 5_000,
      minRequestSpacingMs: 100,
    })

    const start = Date.now()
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)
    await controller.runGeminiRequest(request)

    expect(completeCallCount()).toBe(3)
    expect(Date.now() - start).toBeGreaterThanOrEqual(200)
  })

  it('a probe failure never marks the key wrong unless it was a real auth failure', async () => {
    await saveGeminiKey('good-key-bad-network')
    const { adapter } = makeAdapter({
      probe: () => ({ ok: false, kind: 'unreachable', offline: false }),
    })
    const controller = new GeminiController(adapter)

    const status = await controller.refreshStatus()
    expect(status).toBe('unreachable')
    expect((await getGeminiCredential())?.lastValidation?.status).toBe(
      'unreachable',
    )
  })
})
