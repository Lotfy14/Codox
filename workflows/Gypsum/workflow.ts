import type { WorkflowDefinition } from '../types'
import { DEFAULT_GYPSUM_MODELS, GYPSUM_STEPS, type GypsumModels } from './engine/model-steps'

export const GYPSUM_WORKFLOW: WorkflowDefinition = {
  id: 'gypsum',
  name: 'Gypsum',
  version: '0.2.0',
  description: 'IGCSE MCQ extraction tuned for complete questions, diagrams, graphs, and tables.',
  status: 'experimental',
  render: { dpi: 200, reinitEvery: 8 },
  models: {
    steps: GYPSUM_STEPS,
    defaults: DEFAULT_GYPSUM_MODELS,
    groups: [
      { steps: ['extract'] satisfies (keyof GypsumModels)[], label: 'Page extraction', hint: 'Reads each core page independently, including its MCQs and visual geometry.' },
      { steps: ['key'] satisfies (keyof GypsumModels)[], label: 'Mark scheme', hint: 'Copies printed answer letters from attached IGCSE mark schemes.' },
      { steps: ['audit'] satisfies (keyof GypsumModels)[], label: 'Independent audit', hint: 'Checks questions, choices, and required visuals against the source pages.' },
      { steps: ['crop_check'] satisfies (keyof GypsumModels)[], label: 'Image quality', hint: 'Inspects actual crops, repairs clipping or pollution, and verifies corrected JPEGs.' },
    ],
  },
  async run(runId, pdfBytes, options) {
    const { executeRun } = await import('./engine/executor')
    return executeRun(runId, pdfBytes, {
      signal: options.signal,
      examPageCount: options.examPageCount,
      answerKeyBytes: options.answerKeyBytes,
      answerKeyPageCount: options.answerKeyPageCount,
      answerKeyMimeType: options.answerKeyMimeType,
      dpi: GYPSUM_WORKFLOW.render.dpi,
      reinitEvery: GYPSUM_WORKFLOW.render.reinitEvery,
      models: options.models as Partial<GypsumModels> | undefined,
    })
  },
}
