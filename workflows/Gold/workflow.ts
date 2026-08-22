import { DEFAULT_ENGINE_MODELS, ENGINE_STEPS } from './engine/model-steps'
import type { EngineModels } from './engine/model-steps'
import type { WorkflowDefinition } from '../types'

/**
 * The original, fully verified Codox conversion strategy: Planner → Worker →
 * Audit, with full-page reading, focused review crops, independent
 * inline-answer confirmation, deterministic validation, and the read-only
 * audit gate.
 *
 * This module is Gold's identity AND its policy — the values below are Gold's
 * to change, not shared defaults it inherits. It must stay light: the
 * registry that imports it is reachable from the settings module, so the
 * engine is loaded lazily inside `run` and the pdfium constants are restated
 * here rather than imported (importing `src/pdf/pdfium` would pull the WASM
 * binding into every bundle that reads a setting).
 */
export const GOLD_WORKFLOW: WorkflowDefinition = {
  id: 'gold',
  name: 'Gold',
  version: '1.1.0',
  description: 'The verified Codox workflow. Best choice when accuracy matters.',
  status: 'verified',

  /**
   * Gold reads full pages at the pinned reference DPI (Docs/OUTPUT_CONTRACT.md
   * parameters table) and re-inits pdfium every 8 pages as the native-heap
   * safety net behind the ~100 MB working-set target. These match the shared
   * rasteriser's own defaults today, so Gold's rendering is unchanged by
   * being stated here.
   */
  render: {
    dpi: 200,
    reinitEvery: 8,
  },

  /**
   * Gold's six request-making steps and how Customize groups them. The
   * geometry-heavy `box` step defaults to the older model, whose bounding
   * boxes are the measured weak point of the newer one; `figure` follows it.
   */
  models: {
    steps: ENGINE_STEPS,
    defaults: DEFAULT_ENGINE_MODELS,
    groups: [
      {
        steps: ['index', 'evidence', 'audit'] satisfies (keyof EngineModels)[],
        label: 'Planner',
        hint: 'Finding questions, reading answer keys, and final validation.',
      },
      {
        steps: ['worker'] satisfies (keyof EngineModels)[],
        label: 'Worker',
        hint: 'Transcribes questions and choices.',
      },
      {
        steps: ['figure'] satisfies (keyof EngineModels)[],
        label: 'Figure',
        hint: 'Finds essential question-linked figures.',
      },
      {
        steps: ['box'] satisfies (keyof EngineModels)[],
        label: 'Crop',
        hint: 'Draws Review question crops.',
      },
    ],
  },

  async run(runId, pdfBytes, options) {
    // Lazy: keeps the engine's prompts and pdfium out of the settings bundle.
    const { executeRun } = await import('./engine/executor')
    return executeRun(runId, pdfBytes, {
      ...options,
      dpi: GOLD_WORKFLOW.render.dpi,
      reinitEvery: GOLD_WORKFLOW.render.reinitEvery,
      models: options.models as Partial<EngineModels> | undefined,
    })
  },
}
