import { db } from './db'

/**
 * Settings for the opt-in "Export with AI answers" feature — one JSON row
 * in the `meta` table. These knobs belong to the user: which rows the AI
 * may answer, and how confident it must be before an answer is accepted.
 */

/** Which rows the solver answers. */
export type AiScope = 'unanswered' | 'unanswered+verify' | 'all'

/**
 * The acceptance threshold: answers below it stay blank and flagged.
 * 'never' accepts every non-null answer regardless of confidence.
 */
export type AiFlagBelow = 'certain' | 'likely' | 'never'

export interface AiAnswerSettings {
  scope: AiScope
  flagBelow: AiFlagBelow
}

const SETTINGS_KEY = 'aiAnswerSettings'

export const DEFAULT_AI_ANSWER_SETTINGS: AiAnswerSettings = {
  scope: 'unanswered',
  flagBelow: 'certain',
}

const SCOPES: readonly AiScope[] = ['unanswered', 'unanswered+verify', 'all']
const THRESHOLDS: readonly AiFlagBelow[] = ['certain', 'likely', 'never']

/** Reads the saved settings; any missing or malformed value → defaults. */
export async function getAiAnswerSettings(): Promise<AiAnswerSettings> {
  const row = await db.meta.get(SETTINGS_KEY)
  if (row === undefined) return DEFAULT_AI_ANSWER_SETTINGS
  try {
    const parsed = JSON.parse(row.value) as Partial<AiAnswerSettings>
    return {
      scope: SCOPES.includes(parsed.scope as AiScope)
        ? (parsed.scope as AiScope)
        : DEFAULT_AI_ANSWER_SETTINGS.scope,
      flagBelow: THRESHOLDS.includes(parsed.flagBelow as AiFlagBelow)
        ? (parsed.flagBelow as AiFlagBelow)
        : DEFAULT_AI_ANSWER_SETTINGS.flagBelow,
    }
  } catch {
    return DEFAULT_AI_ANSWER_SETTINGS
  }
}

export async function saveAiAnswerSettings(
  settings: AiAnswerSettings,
): Promise<void> {
  await db.meta.put({ key: SETTINGS_KEY, value: JSON.stringify(settings) })
}
