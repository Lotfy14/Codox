import { DEFAULT_GEMINI_VISION_MODEL, type EngineModel } from '../../../src/providers/gemini'

/** Pyrite has one request-making role: combined page-window extraction. */
export const PYRITE_STEPS = ['extract'] as const

export type PyriteModels = Record<(typeof PYRITE_STEPS)[number], string>

export const DEFAULT_PYRITE_MODELS: Record<(typeof PYRITE_STEPS)[number], EngineModel> = {
  extract: DEFAULT_GEMINI_VISION_MODEL,
}
