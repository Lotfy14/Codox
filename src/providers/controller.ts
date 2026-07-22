import {
  getGeminiCredential,
  recordKeyValidation,
} from '../state/credentials'
import { recordDailyRequest } from '../state/quota'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  FALLBACK_GEMINI_VISION_MODEL,
  geminiAdapter,
} from './gemini'
import type { KeyValidationStatus } from '../state/types'
import type {
  GeminiAdapter,
  KeyCheckResult,
  ModelListResult,
  ProviderFailure,
  VisionRequest,
  VisionResult,
} from './types'

/**
 * The engine-facing Gemini API. Phase 6 calls only this module, never the
 * adapter directly.
 *
 * Key provenance rule (auditable): every request reads the key from the
 * singleton credential repository (`src/state/credentials.ts`) at call
 * time. Nothing here accepts a key parameter, and no fallback credential
 * exists — see `controller.test.ts`, which fails if that changes.
 *
 * Model fallback (owner-approved 2026-07-22) is the one place a request's
 * model is swapped at runtime: a request the primary model cannot answer is
 * retried on the known-good `FALLBACK_GEMINI_VISION_MODEL` under the SAME one
 * key. This is a second model, never a second key or provider — the key
 * provenance rule is untouched.
 */

export type ControllerStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'paused'; reason: 'quota' | 'offline'; resumesAt?: number }
  | { kind: 'wrong-key' }
  | { kind: 'unreachable' }

export type ControllerEvent =
  | { type: 'running' }
  | { type: 'paused'; reason: 'quota' | 'offline'; resumesAt?: number }
  | { type: 'resumed' }
  | { type: 'wrong-key' }
  | { type: 'unreachable' }

type Listener = (event: ControllerEvent) => void

/** Re-check cadence when Gemini gave no explicit retry timing. */
const RATE_LIMIT_RECHECK_SECONDS = 30
const QUOTA_RECHECK_SECONDS = 5 * 60
const UNREACHABLE_RECHECK_SECONDS = 60
const TRANSIENT_RETRY_DELAYS_SECONDS = [1, 2, 4] as const

const MISSING_KEY_FAILURE: ProviderFailure = {
  ok: false,
  kind: 'wrong-key',
}

function toValidationStatus(failure: ProviderFailure): KeyValidationStatus {
  if (
    failure.code === 'billing-required' ||
    failure.code === 'model-unavailable'
  ) {
    return 'setup-required'
  }
  switch (failure.kind) {
    case 'wrong-key':
      return 'wrong-key'
    case 'quota-exhausted':
    case 'rate-limited':
      return 'quota-paused'
    // provider-error reads as "can't reach right now" — blue-neutral,
    // never accusing the key.
    case 'unreachable':
    case 'provider-error':
    case 'aborted':
      return 'unreachable'
  }
}

export interface GeminiControllerOptions {
  /** Waits between transient retries (5xx and empty completions). */
  transientRetryDelaysSeconds?: readonly number[]
  /** Requests allowed per pacing window. */
  maxRpm?: number
  /**
   * The pacing window. Deliberately LONGER than Google's 60s: we can only
   * pace when requests START, but Google counts when they ARRIVE — a small
   * request sent right after a slow multi-megabyte page upload can land in
   * the same provider minute as requests from our previous window. The
   * padding absorbs that arrival compression (observed as >14 requests in
   * an AI Studio minute during the BOX pass).
   */
  rpmWindowMs?: number
  /** Minimum gap between request starts; breaks up concurrent-call bursts. */
  minRequestSpacingMs?: number
}

export class GeminiController {
  private readonly adapter: GeminiAdapter
  private readonly listeners = new Set<Listener>()
  private status: ControllerStatus = { kind: 'idle' }
  private readonly requestTimestamps: number[] = []
  private readonly maxRpm: number
  private readonly rpmWindowMs: number
  private readonly minRequestSpacingMs: number
  private readonly transientRetryDelaysSeconds: readonly number[]
  /**
   * Primary models this session's key has proven it cannot run (a missing
   * model or a billing wall). Once a model lands here, requests for it skip
   * straight to the fallback — so a key without the new primary wastes exactly
   * ONE doomed call per session, not one per request (COST-ZERO). Per-instance
   * and non-persistent: a fresh launch re-tries the primary.
   */
  private readonly unavailablePrimaryModels = new Set<string>()

  constructor(
    adapter: GeminiAdapter = geminiAdapter,
    options: GeminiControllerOptions = {},
  ) {
    this.adapter = adapter
    this.maxRpm = options.maxRpm ?? 14
    this.rpmWindowMs = options.rpmWindowMs ?? 70_000
    this.minRequestSpacingMs = options.minRequestSpacingMs ?? 1_000
    this.transientRetryDelaysSeconds =
      options.transientRetryDelaysSeconds ?? TRANSIENT_RETRY_DELAYS_SECONDS
  }

  getStatus(): ControllerStatus {
    return this.status
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ControllerEvent): void {
    if (event.type === 'running' || event.type === 'resumed') {
      this.status = { kind: 'running' }
    } else if (event.type === 'paused') {
      this.status = {
        kind: 'paused',
        reason: event.reason,
        resumesAt: event.resumesAt,
      }
    } else {
      this.status = { kind: event.type }
    }
    for (const listener of this.listeners) listener(event)
  }

  /**
   * Startup/manual status check. Runs the cheap probe with the stored key
   * and records the observed status. Never marks the key wrong unless
   * Gemini returned a real auth failure (the taxonomy guarantees this:
   * network failures map to `unreachable`, not `wrong-key`).
   */
  async refreshStatus(signal?: AbortSignal): Promise<KeyValidationStatus | 'no-key'> {
    const credential = await getGeminiCredential()
    if (credential === undefined) return 'no-key'

    const result = await this.adapter.probe(credential.apiKey, signal)
    // A cheap reachability probe must never upgrade an unchecked key (or a
    // key lacking billing/model access) to "working". Only validateKey's
    // real generation call earns that status.
    if (result.ok) return credential.lastValidation?.status ?? 'working'
    const status = toValidationStatus(result)
    if (result.kind === 'aborted') return status
    await recordKeyValidation(status)
    if (status === 'wrong-key') this.emit({ type: 'wrong-key' })
    else if (status === 'unreachable') this.emit({ type: 'unreachable' })
    return status
  }

  /**
   * Validates the stored key with a live call and records the outcome.
   * Used by the API-key panel's "Check key" action.
   */
  async validateStoredKey(signal?: AbortSignal): Promise<KeyCheckResult> {
    const credential = await getGeminiCredential()
    if (credential === undefined) return MISSING_KEY_FAILURE

    const result = await this.adapter.validateKey(credential.apiKey, signal)
    // The key check is a real (tiny) generation, so it counts too.
    if (result.ok) await recordDailyRequest()
    if (!result.ok && result.kind === 'aborted') return result
    await recordKeyValidation(
      result.ok ? 'working' : toValidationStatus(result),
    )
    return result
  }

  /**
   * The models the stored key can actually call. The engine uses this to
   * resolve unverified model IDs (§1.2) instead of silently aliasing them.
   */
  async listModels(signal?: AbortSignal): Promise<ModelListResult> {
    const credential = await getGeminiCredential()
    if (credential === undefined) return MISSING_KEY_FAILURE
    return this.adapter.listModels(credential.apiKey, signal)
  }

  /**
   * One engine-facing vision request under the locally stored key.
   *
   * The primary model (what the caller asked for) gets first refusal; a
   * request it cannot answer is retried once on the request's own
   * `fallbackModelId` — the role's paired model, set by the engine call
   * builders to "the model the tutor didn't pick" — or, when the caller set
   * none, the global known-good `FALLBACK_GEMINI_VISION_MODEL`
   * (owner-approved 2026-07-22). "Cannot
   * answer" means: a per-minute rate limit, a provider error, a
   * missing/billing-gated model, or a body still empty after the primary's own
   * transient retries. `wrong-key` (same key for both models) and a user abort
   * are returned as-is, never masked by a swap; `unreachable` and daily
   * `quota-exhausted` are key-wide, so the primary keeps its calm pause instead
   * of a futile model swap. The fallback runs the full calm behavior — its own
   * quota pause and offline resume — so "paused, not broken" still shows when
   * BOTH models are stalled.
   */
  async runGeminiRequest(
    request: VisionRequest,
    opts: { signal?: AbortSignal } = {},
  ): Promise<VisionResult> {
    const { signal } = opts
    const primaryModel = request.modelId ?? DEFAULT_GEMINI_VISION_MODEL
    // The role's own paired fallback ("the model the tutor didn't pick"), or the
    // global known-good fallback when the caller set none (post-audit AI steps).
    const fallbackModel = request.fallbackModelId ?? FALLBACK_GEMINI_VISION_MODEL

    // When the primary already IS the fallback, the second attempt would be
    // identical, so the primary attempt is the only one.
    const primaryIsFallback = primaryModel === fallbackModel
    if (!primaryIsFallback && !this.unavailablePrimaryModels.has(primaryModel)) {
      const primary = await this.attemptModel(request, true, signal)
      switch (primaryDisposition(primary)) {
        case 'return':
          return primary
        case 'disable-and-fall-back':
          this.unavailablePrimaryModels.add(primaryModel)
          break
        case 'fall-back':
          break
      }
    }

    // Fall back to the role's known-good model with the full calm behavior.
    // (When the caller already asked for the fallback model, this is the only
    // attempt and reuses the request object untouched.)
    const fallbackRequest: VisionRequest = primaryIsFallback
      ? request
      : { ...request, modelId: fallbackModel }
    return this.attemptModel(fallbackRequest, false, signal)
  }

  /**
   * One model's full attempt loop: RPM pacing, transient/empty retries, and
   * the calm pause/resume for quota and offline. `failFastOnRateLimit` lets
   * the primary bail out of a per-minute limit (returning `rate-limited`) so
   * the caller can try the fallback model instead of waiting; the fallback
   * runs with it off and keeps the pause.
   */
  private async attemptModel(
    request: VisionRequest,
    failFastOnRateLimit: boolean,
    signal?: AbortSignal,
  ): Promise<VisionResult> {
    let transientAttempt = 0
    for (;;) {
      if (signal?.aborted) return { ok: false, kind: 'aborted' }

      // Read the key fresh on every attempt: a key replaced mid-pause is
      // picked up; a removed key ends the run.
      const credential = await getGeminiCredential()
      if (credential === undefined) {
        this.emit({ type: 'wrong-key' })
        return MISSING_KEY_FAILURE
      }

      this.emit({ type: 'running' })
      await this.throttleRequest(signal)
      if (signal?.aborted) return { ok: false, kind: 'aborted' }

      const result = await this.adapter.complete(
        request,
        credential.apiKey,
        signal,
      )

      if (result.ok) {
        // Every answered generation counts against the key's daily free
        // allowance (429/offline attempts never reached generation).
        await recordDailyRequest()
        // A 200 with an empty body and a normal finish is a provider hiccup
        // (observed on Flash-Lite: two consecutive empty responses killed a
        // 30-page run at its last worker chunk). No prompt in this app ever
        // legitimately answers with nothing, so retry it as transient rather
        // than letting it consume a content-repair round downstream. An
        // abnormal finish (SAFETY, MAX_TOKENS…) is deterministic and is
        // returned for the engine's own gates to judge. After the bounded
        // retries the empty result is returned unchanged — never an error.
        const emptyBody =
          result.text.trim() === '' &&
          (result.finishReason === undefined || result.finishReason === 'STOP')
        const retryDelay = this.transientRetryDelaysSeconds[transientAttempt]
        if (!emptyBody || retryDelay === undefined) return result
        transientAttempt += 1
        await waitForResume(retryDelay, signal)
        if (signal?.aborted) return { ok: false, kind: 'aborted' }
        continue
      }

      switch (result.kind) {
        case 'wrong-key':
          await recordKeyValidation('wrong-key')
          this.emit({ type: 'wrong-key' })
          return result
        case 'quota-exhausted':
        case 'rate-limited': {
          // A per-minute limit on the primary is worth escaping to the
          // fallback model (which may have its own RPM headroom). A per-day
          // exhaustion is key-wide, so a swap is futile — pause instead.
          if (failFastOnRateLimit && result.kind === 'rate-limited') {
            return result
          }
          const waitSeconds =
            result.retryAfterSeconds ??
            (result.kind === 'quota-exhausted'
              ? QUOTA_RECHECK_SECONDS
              : RATE_LIMIT_RECHECK_SECONDS)
          this.emit({
            type: 'paused',
            reason: 'quota',
            resumesAt: Date.now() + waitSeconds * 1000,
          })
          await waitForResume(waitSeconds, signal)
          if (signal?.aborted) return { ok: false, kind: 'aborted' }
          this.emit({ type: 'resumed' })
          break
        }
        case 'unreachable': {
          this.emit({ type: 'paused', reason: 'offline' })
          await waitForResume(UNREACHABLE_RECHECK_SECONDS, signal, true)
          if (signal?.aborted) return { ok: false, kind: 'aborted' }
          this.emit({ type: 'resumed' })
          break
        }
        case 'aborted':
          return result
        case 'provider-error': {
          const transient =
            result.httpStatus === 408 ||
            result.httpStatus === 499 ||
            (result.httpStatus !== undefined && result.httpStatus >= 500)
          const defaultWait = this.transientRetryDelaysSeconds[transientAttempt]
          if (!transient || defaultWait === undefined) return result
          const waitSeconds = result.retryAfterSeconds ?? defaultWait
          transientAttempt += 1
          await waitForResume(waitSeconds, signal)
          if (signal?.aborted) return { ok: false, kind: 'aborted' }
          break
        }
      }
    }
  }

  private async throttleRequest(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) return

      const now = Date.now()
      while (
        this.requestTimestamps.length > 0 &&
        now - this.requestTimestamps[0] >= this.rpmWindowMs
      ) {
        this.requestTimestamps.shift()
      }

      if (this.requestTimestamps.length < this.maxRpm) {
        const last = this.requestTimestamps[this.requestTimestamps.length - 1]
        if (last === undefined || now - last >= this.minRequestSpacingMs) {
          this.requestTimestamps.push(now)
          return
        }
        // Spacing wait: sub-second, so no paused state — a blink of
        // "paused" for every request would read as constant trouble.
        await sleepMs(last + this.minRequestSpacingMs - now, signal)
        continue
      }

      const oldest = this.requestTimestamps[0]
      const waitMs = Math.max(0, this.rpmWindowMs - (now - oldest)) + 100
      this.emit({
        type: 'paused',
        reason: 'quota',
        resumesAt: now + waitMs,
      })
      await sleepMs(waitMs, signal)
      if (signal?.aborted) return
      this.emit({ type: 'resumed' })
    }
  }
}

/** What to do with a primary-model attempt's outcome. */
type PrimaryDisposition = 'return' | 'fall-back' | 'disable-and-fall-back'

/**
 * Reads a primary-model result and decides whether the fallback model gets a
 * turn. Only outcomes the primary attempt actually returns are considered:
 * daily quota and offline pause internally, so they never reach here.
 */
function primaryDisposition(result: VisionResult): PrimaryDisposition {
  if (result.ok) {
    // A usable answer ends it. A body still empty after the primary's own
    // transient retries earns one more shot on the fallback (a different model
    // may not blank or safety-block the same page).
    return result.text.trim() === '' ? 'fall-back' : 'return'
  }
  switch (result.kind) {
    case 'wrong-key': // same key for both models — a swap would only mask it
    case 'aborted': // user stop
    case 'unreachable': // network, model-agnostic (does not normally surface)
    case 'quota-exhausted': // key-wide daily cap (does not surface; primary pauses)
      return 'return'
    case 'rate-limited':
      return 'fall-back'
    case 'provider-error':
      // A deterministic bad request fails identically on the fallback, so it
      // returns as-is. A missing model or a billing wall is model-specific:
      // fall back AND stop trying this primary for the session.
      if (result.code === 'invalid-request') return 'return'
      if (
        result.code === 'model-unavailable' ||
        result.code === 'billing-required'
      ) {
        return 'disable-and-fall-back'
      }
      return 'fall-back'
  }
}

/** Sleeps for `ms`, resolving early if the abort signal fires. */
function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | undefined
    const onDone = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onDone)
      resolve()
    }
    timer = setTimeout(onDone, ms) as unknown as number
    signal?.addEventListener('abort', onDone, { once: true })
  })
}

/**
 * Sleeps until the retry window elapses, the abort signal fires, or —
 * when waiting on connectivity — the browser reports `online`.
 */
function waitForResume(
  seconds: number,
  signal?: AbortSignal,
  resumeOnOnline = false,
): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onDone)
      if (resumeOnOnline) window.removeEventListener('online', onDone)
      resolve()
    }
    const onDone = () => cleanup()
    timer = setTimeout(onDone, seconds * 1000) as unknown as number
    signal?.addEventListener('abort', onDone, { once: true })
    if (resumeOnOnline) window.addEventListener('online', onDone, { once: true })
  })
}

/** The app-wide controller instance. */
export const geminiController = new GeminiController()
