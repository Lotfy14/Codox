/** Select the planner fallback when its primary model is unavailable. */
import type { GeminiController } from '../providers/controller'
import { PLANNER_FALLBACK_MODEL, PLANNER_MODEL } from './calls'

export interface PlannerModelChoice {
  intended: string
  chosen: string
  reason: string
}

export async function resolvePlannerModel(
  controller: GeminiController,
  signal?: AbortSignal,
): Promise<PlannerModelChoice> {
  const listing = await controller.listModels(signal)
  if (!listing.ok) {
    return {
      intended: PLANNER_MODEL,
      chosen: PLANNER_FALLBACK_MODEL,
      reason: `model listing unavailable (${listing.kind}); using the configured fallback`,
    }
  }
  if (listing.modelIds.includes(PLANNER_MODEL)) {
    return {
      intended: PLANNER_MODEL,
      chosen: PLANNER_MODEL,
      reason: 'the primary planner model exists on this key',
    }
  }
  return {
    intended: PLANNER_MODEL,
    chosen: PLANNER_FALLBACK_MODEL,
    reason: `"${PLANNER_MODEL}" is not in this key's model listing; using the configured planner fallback`,
  }
}
