import { GOLD_WORKFLOW } from './Gold/workflow'
import { PYRITE_WORKFLOW } from './Pyrite/workflow'
import { GYPSUM_WORKFLOW } from './Gypsum/workflow'
import type { WorkflowDefinition } from './types'

/** All workflows that have passed their own benchmark contract. */
export const WORKFLOWS: readonly WorkflowDefinition[] = [GOLD_WORKFLOW, GYPSUM_WORKFLOW, PYRITE_WORKFLOW]

export type WorkflowId = (typeof WORKFLOWS)[number]['id']

export const DEFAULT_WORKFLOW_ID: WorkflowId = GOLD_WORKFLOW.id

export function isWorkflowId(value: unknown): value is WorkflowId {
  return WORKFLOWS.some((workflow) => workflow.id === value)
}

/**
 * The workflow a run should use. A stored id that no longer exists (a
 * removed or renamed mineral) falls back to the default rather than
 * stopping the run — the tutor's work is never blocked by a stale setting.
 */
export function workflowFor(id: string | undefined): WorkflowDefinition {
  return (
    WORKFLOWS.find((workflow) => workflow.id === id) ??
    WORKFLOWS.find((workflow) => workflow.id === DEFAULT_WORKFLOW_ID) ??
    GOLD_WORKFLOW
  )
}
