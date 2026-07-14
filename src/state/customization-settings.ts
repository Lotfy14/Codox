import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { YearMode } from './types'

/**
 * The Customizations tab's settings — one JSON row in the `meta` table
 * (same pattern as `ai-answers-settings.ts`). These govern which optional
 * inputs the Convert screen shows and which optional columns exports gain;
 * they apply to conversions the user starts next, never to finished runs
 * (runs snapshot their own settings at creation).
 */

/** 'off' hides the topics inputs and the topic/subtopic export columns. */
export type TopicsMode = 'off' | 'on'

export interface CustomizationSettings {
  yearMode: YearMode
  topicsMode: TopicsMode
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
}

const YEAR_MODES: readonly YearMode[] = ['off', 'type', 'ai']
const TOPICS_MODES: readonly TopicsMode[] = ['off', 'on']

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
