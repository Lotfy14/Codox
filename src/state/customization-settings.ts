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
  debugConsole: false,
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
