/**
 * Provider-layer contracts. One interface, one Gemini adapter — the engine
 * (Phase 6) never sees HTTP details, only these shapes.
 *
 * The adapter moves bytes. It holds no prompts, formats no engine output,
 * never retries on its own, and never logs or embeds the API key anywhere
 * but the auth header.
 */

/**
 * The closed failure taxonomy. Every failed provider interaction lands in
 * exactly one bucket; unknown failures land in `provider-error`, never in
 * `wrong-key` (a probe must not accuse a good key).
 */
export type ProviderFailureKind =
  | 'wrong-key'
  | 'quota-exhausted'
  | 'rate-limited'
  | 'unreachable'
  | 'provider-error'
  | 'aborted'

export interface ProviderFailure {
  ok: false
  kind: ProviderFailureKind
  /**
   * Seconds until the provider suggests retrying, when it said so
   * (RetryInfo detail or Retry-After header). Undefined otherwise.
   */
  retryAfterSeconds?: number
  /**
   * For `unreachable` only: true when the device itself reports being
   * offline, false when the network is up but the provider can't be
   * reached. Distinguishes "you are offline" from "Gemini is down".
   */
  offline?: boolean
  /** HTTP status when a response was received. Never contains the key. */
  httpStatus?: number
}

export interface ProbeSuccess {
  ok: true
}

/** Reachability probe outcome. Cheap; never spends meaningful quota. */
export type ProbeResult = ProbeSuccess | ProviderFailure

export interface KeyCheckSuccess {
  ok: true
}

/** Live key validation outcome. */
export type KeyCheckResult = KeyCheckSuccess | ProviderFailure

/** One page image plus the text prompt that should accompany it. */
export interface VisionRequest {
  /** Instruction text. The adapter passes it through untouched. */
  prompt: string
  images: ReadonlyArray<{
    /** e.g. `image/png`, `image/webp` */
    mimeType: string
    /** Base64-encoded image bytes, no data-URL prefix. */
    base64Data: string
  }>
  /** Model id override; the adapter's default free vision model otherwise. */
  modelId?: string
}

export interface VisionSuccess {
  ok: true
  /** Concatenated text of the first candidate. */
  text: string
}

export type VisionResult = VisionSuccess | ProviderFailure

export interface GeminiAdapter {
  id: 'gemini'
  name: 'Google Gemini'
  /** Cheap reachability probe; never spends meaningful quota. */
  probe(key: string, signal?: AbortSignal): Promise<ProbeResult>
  /** Live key validation: minimal real call that proves the key works. */
  validateKey(key: string, signal?: AbortSignal): Promise<KeyCheckResult>
  /** One vision call: page image(s) + prompt in, text out. */
  complete(
    request: VisionRequest,
    key: string,
    signal?: AbortSignal,
  ): Promise<VisionResult>
}
