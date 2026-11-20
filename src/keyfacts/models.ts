/**
 * The Key facts area's two modes (owner decision, 2026-11-17, after grading
 * free models blind on 50 key facts: 3.5 Flash 90% good cards, 3.6 Flash 81%,
 * 3.1 Flash-Lite 78%, 3.5 Flash-Lite 74%).
 *
 * Normal: 3.1 Flash-Lite, then 3.5 Flash-Lite — about 500 free requests a day each.
 * Pro:    3.5 Flash, then 3.6 Flash — only 20 free requests a day each, so the
 *         remaining allowance is shown at the top of the area.
 *
 * Each pair goes on the request as `modelId` / `fallbackModelId`, so the
 * controller's runtime fallback and demotion work exactly as for conversions.
 * Same one key, Gemini only: these are models, never another key or provider.
 */
import type { FactsContract } from '../triviadox/jobs'

export type KeyFactMode = 'normal' | 'pro'

export interface ModelPair {
  primary: string
  fallback: string
}

export const KEY_FACT_MODES: Record<KeyFactMode, ModelPair> = {
  normal: { primary: 'gemini-3.1-flash-lite', fallback: 'gemini-3.5-flash-lite' },
  pro: { primary: 'gemini-3.5-flash', fallback: 'gemini-3.6-flash' },
}

/**
 * Questions per key-fact request, by the reply contract the job's prompt asks
 * for (`JobPayload.prompts.keyFactsContract`). 25 measured on Flash-Lite
 * 2026-11-17; 40 is the key-fact lab's E2 (2026-11-20), where writing each fact
 * beside its question kept 40 a request accurate.
 */
export const QUESTIONS_PER_REQUEST: Record<FactsContract, number> = { 1: 25, 2: 40 }
/** Facts per flashcard request (measured on Flash-Lite and Flash, 2026-11-17). */
export const FACTS_PER_REQUEST = 20
