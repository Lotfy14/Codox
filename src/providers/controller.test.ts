import 'fake-indexeddb/auto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../state/db'
import { getGeminiCredential, saveGeminiKey } from '../state/credentials'
import { GeminiController } from './controller'
import type { ControllerEvent } from './controller'
import type {
  GeminiAdapter,
  KeyCheckResult,
  ProbeResult,
  VisionResult,
} from './types'

function makeAdapter(overrides: {
  complete?: (key: string) => VisionResult | Promise<VisionResult>
  probe?: (key: string) => ProbeResult | Promise<ProbeResult>
  validateKey?: (key: string) => KeyCheckResult | Promise<KeyCheckResult>
}) {
  const keysSeen: string[] = []
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
    async complete(_request, key) {
      keysSeen.push(key)
      completeCalls += 1
      return overrides.complete?.(key) ?? { ok: true, text: 'ok' }
    },
  }
  return {
    adapter,
    keysSeen,
    completeCallCount: () => completeCalls,
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
    const controller = new GeminiController(adapter)

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
    const controller = new GeminiController(adapter, [0, 0, 0])

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: true, text: '{"rows":[]}' })
    expect(completeCallCount()).toBe(3)
  })

  it('returns the empty completion unchanged once transient retries are exhausted', async () => {
    await saveGeminiKey('working-key')
    const { adapter, completeCallCount } = makeAdapter({
      complete: () => ({ ok: true, text: '   ', finishReason: 'STOP' }),
    })
    const controller = new GeminiController(adapter, [0, 0, 0])

    const result = await controller.runGeminiRequest(request)

    // Still a success — downstream content validation owns the verdict.
    expect(result).toMatchObject({ ok: true, text: '   ' })
    expect(completeCallCount()).toBe(4)
  })

  it('does not retry an empty completion with an abnormal finish reason', async () => {
    await saveGeminiKey('working-key')
    const { adapter, completeCallCount } = makeAdapter({
      complete: () => ({ ok: true, text: '', finishReason: 'SAFETY' }),
    })
    const controller = new GeminiController(adapter, [0, 0, 0])

    const result = await controller.runGeminiRequest(request)

    expect(result).toMatchObject({ ok: true, text: '', finishReason: 'SAFETY' })
    expect(completeCallCount()).toBe(1)
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

  it('a 429 produces a calm paused state, then resumes and completes', async () => {
    await saveGeminiKey('quota-key')
    let attempt = 0
    const { adapter } = makeAdapter({
      complete: () => {
        attempt += 1
        return attempt === 1
          ? {
              ok: false,
              kind: 'rate-limited',
              retryAfterSeconds: 0,
              httpStatus: 429,
            }
          : { ok: true, text: 'done' }
      },
    })
    const controller = new GeminiController(adapter)
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)

    expect(result.ok).toBe(true)
    expect(events.map((event) => event.type)).toEqual([
      'running',
      'paused',
      'resumed',
      'running',
    ])
    const paused = events[1]
    if (paused.type === 'paused') {
      expect(paused.reason).toBe('quota')
      expect(paused.resumesAt).toBeTypeOf('number')
    }
  })

  it('daily quota exhaustion also pauses as quota, using retry timing', async () => {
    await saveGeminiKey('quota-key')
    let attempt = 0
    const { adapter } = makeAdapter({
      complete: () => {
        attempt += 1
        return attempt === 1
          ? {
              ok: false,
              kind: 'quota-exhausted',
              retryAfterSeconds: 0,
              httpStatus: 429,
            }
          : { ok: true, text: 'done' }
      },
    })
    const controller = new GeminiController(adapter)
    const events: ControllerEvent[] = []
    controller.subscribe((event) => events.push(event))

    const result = await controller.runGeminiRequest(request)
    expect(result.ok).toBe(true)
    expect(events[1]).toMatchObject({ type: 'paused', reason: 'quota' })
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
    const controller = new GeminiController(adapter)
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
