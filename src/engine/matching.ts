/**
 * Matching-question policy (Customize → "Matching questions").
 *
 * A true matching question ("Match each drug with its mechanism: 1… 2… /
 * A… B…") reaches merge as ONE row whose real answer is a set of pairings.
 * Triviadox rows carry a single `correct_index`, so that row can never be
 * imported as it stands. This pass gives the tutor two ways out:
 *
 *   'split' — (default) emit one ordinary MCQ per left-column item, whose
 *             options are the right column copied verbatim.
 *   'skip'  — drop those rows entirely.
 *
 * NEVER-GUESS holds throughout. The model's only job is to say which rows
 * are matching rows and to separate text the worker already transcribed into
 * its two columns; every span it returns must appear verbatim in the source
 * row or the row is left untouched (`verbatimIn` below — enforced in code,
 * not only in the prompt). Code owns every word of the split row's wrapper,
 * and split rows always ship with a blank answer for the tutor to fill.
 *
 * The pass runs after the audit gate, so the engine's rows still validate
 * and audit 1:1 against the pinned blueprint; only the post-audit rows are
 * reshaped.
 */
import type { VisionRequest } from '../providers/types'
import type { GeminiController } from '../providers/controller'
import type { MergedRow } from './types'
import type { MatchingMode } from '../state/customization-settings'
import { MATCHING_SPLIT_PROMPT } from './matching-prompt'
import { recordRequestUsage } from '../state/runs'
import { parseModelJson, isRecord } from './json'
import { logEvent } from '../state/diagnostics'

/**
 * Cheap code gate: unless a row's text talks about matching or pairing, the
 * run never spends a request. Deliberately loose — the model makes the real
 * call, so a false candidate costs nothing but a line of prompt.
 */
const MATCHING_KEYWORDS = /\bmatch(?:es|ed|ing)?\b|\bpair(?:s|ed|ing)?\b/i

/** Separator for split row ids: `12` → `12~m1`, `12~m2`, … */
const SPLIT_MARKER = '~m'

/** The one code-owned word in a split row's question. */
const SPLIT_LABEL = 'Match:'

/** Fewer than this on either side is not a matching question. */
const MIN_COLUMN = 2

/** `12~m3` → `12`; any other id is returned unchanged. */
export function parentRowId(id: string): string {
  const marker = id.lastIndexOf(SPLIT_MARKER)
  return marker === -1 ? id : id.slice(0, marker)
}

/** Whitespace-collapsed, case-folded — how verbatim spans are compared. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The NEVER-GUESS gate: a span counts only when it really is in the source
 * row. Anything the model wrote itself fails here and the row is kept as-is.
 */
function verbatimIn(haystack: string, span: string): boolean {
  const needle = normalize(span)
  return needle !== '' && haystack.includes(needle)
}

interface MatchingSplit {
  id: string
  instruction: string
  items: string[]
  options: string[]
}

function buildMatchingRequest(
  rows: readonly MergedRow[],
  previousError?: string,
): VisionRequest {
  const parts = [
    MATCHING_SPLIT_PROMPT,
    '',
    'ROWS:',
    JSON.stringify({
      rows: rows.map((row) => ({
        id: row.id,
        question: row.question,
        options: row.options,
      })),
    }),
  ]
  if (previousError !== undefined) {
    parts.push(
      '',
      'Your previous response failed validation with this error. Return a',
      'corrected response in the same JSON shape.',
      '',
      `VALIDATION ERROR: ${previousError}`,
    )
  }
  return {
    prompt: parts.join('\n'),
    images: [],
    modelId: 'gemini-3.1-flash-lite',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 32768,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          rows: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                is_matching: { type: 'BOOLEAN' },
                instruction: { type: 'STRING' },
                items: { type: 'ARRAY', items: { type: 'STRING' } },
                options: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['id', 'is_matching'],
            },
          },
        },
        required: ['rows'],
      },
    },
  }
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const trimmed = entry.trim()
    if (trimmed !== '') out.push(trimmed)
  }
  return out
}

/**
 * Narrows the response and drops any claimed matching row that does not
 * survive the verbatim check or the column-size floor. A dropped row is not
 * an error — it simply stays exactly as the engine produced it.
 */
export function validateMatchingResponse(
  text: string,
  rows: readonly MergedRow[],
): { ok: true; splits: Map<string, MatchingSplit> } | { ok: false; error: string } {
  const parsed = parseModelJson(text)
  if (parsed.error !== undefined) {
    return { ok: false, error: `response is not JSON: ${parsed.error}` }
  }
  if (!isRecord(parsed.value) || !Array.isArray(parsed.value.rows)) {
    return { ok: false, error: 'missing "rows" array' }
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const splits = new Map<string, MatchingSplit>()
  for (const entry of parsed.value.rows as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      return { ok: false, error: 'a row entry is malformed' }
    }
    const row = byId.get(entry.id)
    if (row === undefined) {
      return { ok: false, error: `unknown row id "${entry.id}"` }
    }
    if (entry.is_matching !== true) continue

    const items = stringArray(entry.items)
    const options = stringArray(entry.options)
    if (items === null || options === null) {
      return { ok: false, error: `row "${entry.id}": items/options are not strings` }
    }
    const instruction =
      typeof entry.instruction === 'string' ? entry.instruction.trim() : ''
    if (items.length < MIN_COLUMN || options.length < MIN_COLUMN) continue

    // Every span must come from this row's own transcribed text. This is
    // what keeps the pass a re-shaping of verbatim text rather than an act
    // of authorship.
    const source = normalize([row.question, ...row.options].join(' '))
    const copied =
      (instruction === '' || verbatimIn(source, instruction)) &&
      items.every((item) => verbatimIn(source, item)) &&
      options.every((option) => verbatimIn(source, option))
    if (!copied) continue

    splits.set(row.id, { id: row.id, instruction, items, options })
  }
  return { ok: true, splits }
}

/**
 * One MCQ per left-column item. The question is a code-owned template over
 * verbatim text; the options are the right column verbatim; the answer is
 * always blank, because the pairing was never read from the page.
 */
export function splitRow(row: MergedRow, split: MatchingSplit): MergedRow[] {
  return split.items.map((item, index) => ({
    ...row,
    id: `${row.id}${SPLIT_MARKER}${index + 1}`,
    question:
      split.instruction === ''
        ? `${SPLIT_LABEL} ${item}`
        : `${split.instruction}\n\n${SPLIT_LABEL} ${item}`,
    options: [...split.options],
    correct_index: '',
    needs_review: row.needs_review !== '' ? row.needs_review : 'matching_split',
  }))
}

/**
 * Applies the tutor's Customize choice. Any failure — no candidates, a dead
 * call, an unusable response — returns the rows untouched: the engine's
 * output is always the safe fallback.
 */
export async function applyMatchingPolicy(
  rows: MergedRow[],
  mode: MatchingMode,
  controller: GeminiController,
  runId: string,
  signal?: AbortSignal,
): Promise<MergedRow[]> {
  // The keyword gate is what keeps this free on ordinary exams: a run whose
  // rows never mention matching or pairing spends no request at all.
  const candidates = rows.filter((row) => MATCHING_KEYWORDS.test(row.question))
  if (candidates.length === 0) return rows

  await logEvent({
    scope: 'engine',
    level: 'info',
    event: 'engine.matching.start',
    runId,
    detail: { mode, candidates: candidates.length },
  })

  let previousError: string | undefined
  let accepted: Map<string, MatchingSplit> | undefined

  // Two attempts, matching the other post-merge passes.
  for (let attempt = 0; attempt < 2 && accepted === undefined; attempt += 1) {
    const result = await controller.runGeminiRequest(
      buildMatchingRequest(candidates, previousError),
      { signal },
    )
    if (!result.ok) {
      await recordRequestUsage(runId)
      await logEvent({
        scope: 'engine',
        level: 'warn',
        event: 'engine.matching.failed_call',
        runId,
        reason: result.kind,
      })
      return rows
    }
    await recordRequestUsage(runId, result.usage)

    const validation = validateMatchingResponse(result.text, candidates)
    if (validation.ok) {
      accepted = validation.splits
    } else {
      previousError = validation.error
      await logEvent({
        scope: 'engine',
        level: 'warn',
        event: 'engine.matching.invalid_response',
        runId,
        reason: validation.error,
      })
    }
  }

  if (accepted === undefined || accepted.size === 0) return rows

  const out: MergedRow[] = []
  for (const row of rows) {
    const split = accepted.get(row.id)
    if (split === undefined) {
      out.push(row)
    } else if (mode === 'split') {
      out.push(...splitRow(row, split))
    }
    // 'skip' drops the row by pushing nothing.
  }

  await logEvent({
    scope: 'engine',
    level: 'info',
    event: 'engine.matching.done',
    runId,
    detail: { mode, matched: accepted.size, rowsBefore: rows.length, rowsAfter: out.length },
  })

  return out
}
