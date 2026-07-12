/**
 * Worker-model resolution (§1.2). `gemma-4-31b-vision` is a design-doc
 * name, not a verified API ID: resolve it against the live `GET /models`
 * listing, record intended ID / chosen ID / reason, and NEVER silently
 * alias. When the intended ID is absent, fall back to the recorded weak
 * model and say so.
 */
import type { GeminiController } from '../providers/controller'
import { INTENDED_WORKER_MODEL, WORKER_FALLBACK_MODEL } from './calls'

export interface WorkerModelChoice {
  intended: string
  chosen: string
  reason: string
}

export async function resolveWorkerModel(
  controller: GeminiController,
  signal?: AbortSignal,
): Promise<WorkerModelChoice> {
  const listing = await controller.listModels(signal)
  if (!listing.ok) {
    return {
      intended: INTENDED_WORKER_MODEL,
      chosen: WORKER_FALLBACK_MODEL,
      reason: `model listing unavailable (${listing.kind}); using the recorded fallback`,
    }
  }
  if (listing.modelIds.includes(INTENDED_WORKER_MODEL)) {
    return {
      intended: INTENDED_WORKER_MODEL,
      chosen: INTENDED_WORKER_MODEL,
      reason: 'the intended worker model exists on this key',
    }
  }
  return {
    intended: INTENDED_WORKER_MODEL,
    chosen: WORKER_FALLBACK_MODEL,
    reason: `"${INTENDED_WORKER_MODEL}" is not in this key's model listing; using the weakest available Gemini vision model as the worker`,
  }
}
