/**
 * The engine steps that make a Gemini request, each independently model-
 * selectable in Customize → Advanced (owner-approved 2026-07-22). A tutor picks
 * each step's PRIMARY from the two selectable models; the model not picked
 * becomes that step's runtime fallback ("the other one is the fallback"),
 * applied by the controller under the SAME one key — a second model, never a
 * second key or provider.
 *
 * Kept in its own tiny module (only a providers/gemini import) so the
 * widely-imported settings and screen bundles don't pull in the engine's
 * prompt strings. The order here is the pipeline order the UI lists them in.
 */
import { DEFAULT_GEMINI_VISION_MODEL, type EngineModel } from '../providers/gemini'

export const ENGINE_STEPS = [
  'index',
  'evidence',
  'figure',
  'box',
  'worker',
  'audit',
] as const

export type EngineStep = (typeof ENGINE_STEPS)[number]

/** Primary model per step. Values are model ids the controller passes through. */
export type EngineModels = Record<EngineStep, string>

/**
 * Every step defaults to the primary vision model, so a tutor who changes
 * nothing gets exactly the pre-selection behavior. `index` also drives the
 * legacy single-planner path and the per-page INDEX repair; the four
 * planner-family steps (index/evidence/figure/box) are independent here.
 */
export const DEFAULT_ENGINE_MODELS: Record<EngineStep, EngineModel> = {
  index: DEFAULT_GEMINI_VISION_MODEL,
  evidence: DEFAULT_GEMINI_VISION_MODEL,
  figure: DEFAULT_GEMINI_VISION_MODEL,
  box: DEFAULT_GEMINI_VISION_MODEL,
  worker: DEFAULT_GEMINI_VISION_MODEL,
  audit: DEFAULT_GEMINI_VISION_MODEL,
}
