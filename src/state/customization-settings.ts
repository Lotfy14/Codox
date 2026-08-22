import { useLiveQuery } from 'dexie-react-hooks'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  SELECTABLE_ENGINE_MODELS,
  type EngineModel,
} from '../providers/gemini'
import { db } from './db'
import type { YearMode } from './types'
import {
  DEFAULT_WORKFLOW_ID,
  isWorkflowId,
  workflowFor,
  type WorkflowId,
} from '../../workflows/registry'

/**
 * The Customizations tab's settings — one JSON row in the `meta` table.
 * These govern which optional inputs the Convert screen shows, which
 * optional columns exports gain, and where the Export button sends the
 * finished set. Column choices apply to conversions the user starts next
 * (runs snapshot their own settings at creation); the export destination
 * applies to every export from now on.
 */

/** 'off' hides the topics inputs and the topic/subtopic export columns. */
export type TopicsMode = 'off' | 'on'

/** Where the Export button sends the finished set. */
export type ExportTarget = 'triviadox' | 'zip'

/**
 * What to do with a true matching question — one row whose answer is a set
 * of pairings, which a single-`correct_index` Triviadox row cannot carry.
 * 'split' (the default) emits one MCQ per left-column item with the right
 * column as its options; 'skip' drops the row. There is deliberately no
 * "ship it as printed" mode: such a row can never be imported as it stands.
 */
export type MatchingMode = 'skip' | 'split'

export interface CustomizationSettings {
  yearMode: YearMode
  topicsMode: TopicsMode
  /** 'triviadox' uploads to the Triviadox import page; 'zip' saves locally. */
  exportTarget: ExportTarget
  /** Named conversion strategy; snapshotted on every run. */
  workflowId: WorkflowId
  /** Shows the Convert screen's step-timing debug console. Off by default. */
  debugConsole: boolean
  /**
   * How matching questions are handled after extraction. Defaults to
   * 'split'. Costs one extra request per run, and only when a row's text
   * actually mentions matching or pairing.
   */
  matchingMode: MatchingMode
  /**
   * Which model each request-making step uses as its PRIMARY (Advanced),
   * keyed by the SELECTED WORKFLOW's own step ids — the steps, their defaults,
   * and their Customize grouping all belong to the workflow, not here. The
   * model NOT chosen becomes that step's runtime fallback ("the other one is
   * the fallback"). All run under the same one user key — a second model,
   * never a second key or provider. Snapshotted per run at creation like the
   * other knobs.
   *
   * Stored flat rather than per workflow: switching workflows falls steps the
   * new one does not recognise back to its defaults. Harmless while one
   * mineral exists; revisit when a second ships with different steps.
   */
  engineModels: Record<string, EngineModel>
}

const SETTINGS_KEY = 'customizationSettings'

/**
 * Both default on: the affordances are visible but cost nothing until the
 * user actually provides data — an empty topic list or year field adds no
 * columns and spends no quota.
 */
export const DEFAULT_CUSTOMIZATION_SETTINGS: CustomizationSettings = {
  yearMode: 'type',
  topicsMode: 'on',
  exportTarget: 'triviadox',
  workflowId: DEFAULT_WORKFLOW_ID,
  debugConsole: false,
  matchingMode: 'split',
  engineModels: { ...workflowFor(DEFAULT_WORKFLOW_ID).models.defaults },
}

const YEAR_MODES: readonly YearMode[] = ['off', 'type', 'ai']
const TOPICS_MODES: readonly TopicsMode[] = ['off', 'on']
const EXPORT_TARGETS: readonly ExportTarget[] = ['triviadox', 'zip']
const MATCHING_MODES: readonly MatchingMode[] = ['skip', 'split']

/** A selectable engine model, or a fallback (legacy value, then the default). */
function engineModel(value: unknown, fallback: EngineModel, legacy?: unknown): EngineModel {
  if (SELECTABLE_ENGINE_MODELS.includes(value as EngineModel)) {
    return value as EngineModel
  }
  if (SELECTABLE_ENGINE_MODELS.includes(legacy as EngineModel)) {
    return legacy as EngineModel
  }
  return fallback
}

/**
 * Per-step primary models for one workflow, narrowing each of ITS steps
 * independently. Falls a missing or unrecognized step back to the
 * first-shipped grouped fields (`plannerModel` → the planner-family steps;
 * `workerModel`/`auditModel`), so the brief 3-picker settings migrate without
 * losing the tutor's choice, then to that step's own default.
 */
function narrowEngineModels(
  parsed: Record<string, unknown>,
  workflowId: WorkflowId,
): Record<string, EngineModel> {
  const { steps, defaults } = workflowFor(workflowId).models
  const stored = (parsed.engineModels ?? {}) as Record<string, unknown>
  const legacy: Record<string, unknown> = {
    index: parsed.plannerModel,
    evidence: parsed.plannerModel,
    figure: parsed.plannerModel,
    box: parsed.plannerModel,
    worker: parsed.workerModel,
    audit: parsed.auditModel,
  }
  const result: Record<string, EngineModel> = {}
  for (const step of steps) {
    result[step] = engineModel(
      stored[step],
      defaults[step] ?? DEFAULT_GEMINI_VISION_MODEL,
      legacy[step],
    )
  }
  return result
}

function narrow(value: string | undefined): CustomizationSettings {
  if (value === undefined) return DEFAULT_CUSTOMIZATION_SETTINGS
  try {
    const parsed = JSON.parse(value) as Partial<CustomizationSettings>
    // Resolved first: the workflow owns which steps exist and what each one
    // defaults to, so the model narrowing below depends on it.
    const workflowId = isWorkflowId(parsed.workflowId)
      ? parsed.workflowId
      : DEFAULT_CUSTOMIZATION_SETTINGS.workflowId
    return {
      yearMode: YEAR_MODES.includes(parsed.yearMode as YearMode)
        ? (parsed.yearMode as YearMode)
        : DEFAULT_CUSTOMIZATION_SETTINGS.yearMode,
      topicsMode: TOPICS_MODES.includes(parsed.topicsMode as TopicsMode)
        ? (parsed.topicsMode as TopicsMode)
        : DEFAULT_CUSTOMIZATION_SETTINGS.topicsMode,
      exportTarget: EXPORT_TARGETS.includes(parsed.exportTarget as ExportTarget)
        ? (parsed.exportTarget as ExportTarget)
        : DEFAULT_CUSTOMIZATION_SETTINGS.exportTarget,
      workflowId,
      debugConsole:
        typeof parsed.debugConsole === 'boolean'
          ? parsed.debugConsole
          : DEFAULT_CUSTOMIZATION_SETTINGS.debugConsole,
      // A stored row from before these were workflow-owned still carries
      // boxCrops / indexPagesPerCall / boxPagesPerCall / workerChunkSize.
      // Reading around them is the migration: the keys are simply not copied
      // out, so the next save drops them.
      matchingMode: MATCHING_MODES.includes(parsed.matchingMode as MatchingMode)
        ? (parsed.matchingMode as MatchingMode)
        : DEFAULT_CUSTOMIZATION_SETTINGS.matchingMode,
      engineModels: narrowEngineModels(
        parsed as Record<string, unknown>,
        workflowId,
      ),
    }
  } catch {
    return DEFAULT_CUSTOMIZATION_SETTINGS
  }
}

/** Reads the saved settings; any missing or malformed value → defaults. */
export async function getCustomizationSettings(): Promise<CustomizationSettings> {
  return narrow((await db.meta.get(SETTINGS_KEY))?.value)
}

export async function saveCustomizationSettings(
  settings: CustomizationSettings,
): Promise<void> {
  await db.meta.put({ key: SETTINGS_KEY, value: JSON.stringify(settings) })
}

/** Live settings for screens; undefined while the first read is in flight. */
export function useCustomizationSettings(): CustomizationSettings | undefined {
  return useLiveQuery(
    async () => narrow((await db.meta.get(SETTINGS_KEY))?.value),
    [],
  )
}
