/**
 * Model-response JSON parsing (pure). Prompts demand raw JSON and calls
 * pin `responseMimeType: application/json`, but a model may still wrap the
 * body in a markdown fence; stripping that fence is deterministic format
 * tolerance, not content repair. Anything else unparseable is a step-gate
 * failure for the caller.
 */

export interface ParsedJson {
  value?: unknown
  error?: string
}

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/

export function parseModelJson(text: string): ParsedJson {
  const trimmed = text.trim()
  const fenced = FENCE.exec(trimmed)
  const body = fenced !== null ? fenced[1] : trimmed
  try {
    return { value: JSON.parse(body) }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'invalid JSON',
    }
  }
}

/** Narrowing helpers shared by the blueprint and chunk validators. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}
