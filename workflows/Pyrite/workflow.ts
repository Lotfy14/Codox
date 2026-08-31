import type { WorkflowDefinition } from '../types'
import { DEFAULT_PYRITE_MODELS, PYRITE_STEPS, type PyriteModels } from './engine/model-steps'

/** Experimental, review-first strategy with one extraction call per page window. */
export const PYRITE_WORKFLOW: WorkflowDefinition = {
  id: 'pyrite',
  name: 'Pyrite',
  version: '0.3.0',
  description: 'Fast draft conversion with far fewer requests. Every result is sent to Review.',
  status: 'experimental',
  // Pyrite needs to work on phone-scanned papers that sometimes advertise a
  // huge physical page size. 120 DPI keeps option marks and highlighter
  // strokes legible while staying within the browser PDF renderer's memory.
  render: { dpi: 120, reinitEvery: 8 },
  models: {
    steps: PYRITE_STEPS,
    defaults: DEFAULT_PYRITE_MODELS,
    groups: [{
      steps: ['extract'] satisfies (keyof PyriteModels)[],
      label: 'Extraction',
      hint: 'Reads questions, choices, and visible answers in one request per page window.',
    }],
  },
  async run(runId, pdfBytes, options) {
    const { executeRun } = await import('./engine/executor')
    return executeRun(runId, pdfBytes, {
      signal: options.signal,
      dpi: PYRITE_WORKFLOW.render.dpi,
      reinitEvery: PYRITE_WORKFLOW.render.reinitEvery,
      examPageCount: options.examPageCount,
      answerKeyBytes: options.answerKeyBytes,
      answerKeyPageCount: options.answerKeyPageCount,
      answerKeyMimeType: options.answerKeyMimeType,
      models: options.models as Partial<PyriteModels> | undefined,
    })
  },
}
