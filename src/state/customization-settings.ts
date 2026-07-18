import { useLiveQuery } from 'dexie-react-hooks'
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

export interface CustomizationSettings {
  yearMode: YearMode
  topicsMode: TopicsMode
  /** 'triviadox' uploads to the Triviadox import page; 'zip' saves locally. */
  exportTarget: ExportTarget
  /** Shows the Convert screen's step-timing debug console. Off by default. */
  debugConsole: boolean
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
}

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
  boxPagesPerCall: BOX_PAGES_MIN,
  workerChunkSize: 6,
}

const YEAR_MODES: readonly YearMode[] = ['off', 'type', 'ai']
const TOPICS_MODES: readonly TopicsMode[] = ['off', 'on']
const EXPORT_TARGETS: readonly ExportTarget[] = ['triviadox', 'zip']

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
      boxPagesPerCall:
        typeof parsed.boxPagesPerCall === 'number' &&
        Number.isInteger(parsed.boxPagesPerCall) &&
        parsed.boxPagesPerCall >= BOX_PAGES_MIN &&
        parsed.boxPagesPerCall <= BOX_PAGES_MAX
          ? parsed.boxPagesPerCall
          : DEFAULT_CUSTOMIZATION_SETTINGS.boxPagesPerCall,
      workerChunkSize:
        typeof parsed.workerChunkSize === 'number' &&
        Number.isInteger(parsed.workerChunkSize) &&
        parsed.workerChunkSize >= WORKER_CHUNK_MIN &&
        parsed.workerChunkSize <= WORKER_CHUNK_MAX
          ? parsed.workerChunkSize
          : DEFAULT_CUSTOMIZATION_SETTINGS.workerChunkSize,
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
