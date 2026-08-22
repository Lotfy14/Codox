import { DEFAULT_GEMINI_VISION_MODEL, type EngineModel } from '../../../src/providers/gemini'

export const GYPSUM_STEPS = ['extract', 'key', 'audit'] as const
export type GypsumStep = (typeof GYPSUM_STEPS)[number]
export type GypsumModels = Record<GypsumStep, string>

export const DEFAULT_GYPSUM_MODELS: Record<GypsumStep, EngineModel> = {
  extract: DEFAULT_GEMINI_VISION_MODEL,
  key: DEFAULT_GEMINI_VISION_MODEL,
  audit: DEFAULT_GEMINI_VISION_MODEL,
}
