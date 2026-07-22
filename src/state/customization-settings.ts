import { useLiveQuery } from 'dexie-react-hooks'
import {
  DEFAULT_GEMINI_VISION_MODEL,
  SELECTABLE_ENGINE_MODELS,
  type EngineModel,
} from '../providers/gemini'
import {
  DEFAULT_ENGINE_MODELS,
  ENGINE_STEPS,
  type EngineStep,
} from '../engine/model-steps'
import { db } from './db'
import type { YearMode } from './types'

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
  /** Shows the Convert screen's step-timing debug console. Off by default. */
  debugConsole: boolean
  /**
   * Pages per INDEX window core. 10 is the default and the safe value.
   * LOWERING THIS LOSES QUESTIONS: more windows means more boundaries, and
   * reconciliation drops rows across them (measured on the embryology
   * document — 10 pages/window found 64 questions, 3 pages/window found 57,
   * with no gain in answers). Kept as a diagnostic knob, not a remedy; a
   * short run should raise it. See CLAUDE.md's 2026-07-20 correction.
   */
  indexPagesPerCall: number
  /**
   * Pages sent per box-drawing request during conversion. 1 (the default)
   * is today's most-accurate per-page pass; higher values spend fewer
   * requests on big exams at some cost in box accuracy.
   */
  boxPagesPerCall: number
  /**
   * Questions the worker transcribes per request. Smaller chunks keep each
   * response short so the weakest model does not abbreviate the later rows
   * (dropping options); larger chunks spend fewer requests. 6 is the default
   * — full transcription at a modest request count.
   */
  workerChunkSize: number
  /**
   * How matching questions are handled after extraction. Defaults to
   * 'split'. Costs one extra request per run, and only when a row's text
   * actually mentions matching or pairing.
   */
  matchingMode: MatchingMode
  /**
   * Which model each request-making engine step uses as its PRIMARY (Advanced).
   * Every step (index, evidence, figure, box, worker, audit) defaults to
   * `DEFAULT_GEMINI_VISION_MODEL`; the model NOT chosen becomes that step's
   * runtime fallback ("the other one is the fallback"). All run under the same
   * one user key — a second model, never a second key or provider. Snapshotted
   * per run at creation like the other knobs.
   */
  engineModels: Record<EngineStep, EngineModel>
}

export const INDEX_PAGES_MIN = 1
export const INDEX_PAGES_MAX = 10

export const BOX_PAGES_MIN = 1
export const BOX_PAGES_MAX = 10

export const WORKER_CHUNK_MIN = 3
export const WORKER_CHUNK_MAX = 12

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
  debugConsole: false,
  indexPagesPerCall: INDEX_PAGES_MAX,
  boxPagesPerCall: BOX_PAGES_MIN,
  workerChunkSize: 6,
  matchingMode: 'split',
  engineModels: { ...DEFAULT_ENGINE_MODELS },
}

const YEAR_MODES: readonly YearMode[] = ['off', 'type', 'ai']
const TOPICS_MODES: readonly TopicsMode[] = ['off', 'on']
const EXPORT_TARGETS: readonly ExportTarget[] = ['triviadox', 'zip']
const MATCHING_MODES: readonly MatchingMode[] = ['skip', 'split']

/** A selectable engine model, or a fallback (legacy value, then the default). */
function engineModel(value: unknown, legacy?: unknown): EngineModel {
  if (SELECTABLE_ENGINE_MODELS.includes(value as EngineModel)) {
    return value as EngineModel
  }
  if (SELECTABLE_ENGINE_MODELS.includes(legacy as EngineModel)) {
    return legacy as EngineModel
  }
  return DEFAULT_GEMINI_VISION_MODEL
}

/**
 * Per-step primary models, narrowing each step independently. Falls a missing
 * or unrecognized step back to the first-shipped grouped fields
 * (`plannerModel` → the four planner-family steps; `workerModel`/`auditModel`),
 * so the brief 3-picker settings migrate without losing the tutor's choice,
 * then to the default primary.
 */
function narrowEngineModels(
  parsed: Record<string, unknown>,
): Record<EngineStep, EngineModel> {
  const stored = (parsed.engineModels ?? {}) as Record<string, unknown>
  const legacy: Record<EngineStep, unknown> = {
    index: parsed.plannerModel,
    evidence: parsed.plannerModel,
    figure: parsed.plannerModel,
    box: parsed.plannerModel,
    worker: parsed.workerModel,
    audit: parsed.auditModel,
  }
  const result = {} as Record<EngineStep, EngineModel>
  for (const step of ENGINE_STEPS) {
    result[step] = engineModel(stored[step], legacy[step])
  }
  return result
}

/** An integer setting inside its range, or the default for anything else. */
function counted(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback
}

function narrow(value: string | undefined): CustomizationSettings {
  if (value === undefined) return DEFAULT_CUSTOMIZATION_SETTINGS
  try {
    const parsed = JSON.parse(value) as Partial<CustomizationSettings>
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
      debugConsole:
        typeof parsed.debugConsole === 'boolean'
          ? parsed.debugConsole
          : DEFAULT_CUSTOMIZATION_SETTINGS.debugConsole,
      indexPagesPerCall: counted(
        parsed.indexPagesPerCall,
        INDEX_PAGES_MIN,
        INDEX_PAGES_MAX,
        DEFAULT_CUSTOMIZATION_SETTINGS.indexPagesPerCall,
      ),
      boxPagesPerCall: counted(
        parsed.boxPagesPerCall,
        BOX_PAGES_MIN,
        BOX_PAGES_MAX,
        DEFAULT_CUSTOMIZATION_SETTINGS.boxPagesPerCall,
      ),
      workerChunkSize: counted(
        parsed.workerChunkSize,
        WORKER_CHUNK_MIN,
        WORKER_CHUNK_MAX,
        DEFAULT_CUSTOMIZATION_SETTINGS.workerChunkSize,
      ),
      matchingMode: MATCHING_MODES.includes(parsed.matchingMode as MatchingMode)
        ? (parsed.matchingMode as MatchingMode)
        : DEFAULT_CUSTOMIZATION_SETTINGS.matchingMode,
      engineModels: narrowEngineModels(parsed as Record<string, unknown>),
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
