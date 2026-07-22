/**
 * The AI topic matcher — labels a finished run's questions with the user's
 * own topic list (Customizations feature, owner-approved 2026-07-14).
 * Deliberately OUTSIDE the pinned engine path, mirroring `solver.ts`: it
 * runs after extraction on a finished run, reads the pristine
 * `merged-rows` artifact plus the run's `topics-list` snapshot, and stores
 * matches in a separate `topic-matches` artifact. Engine output is never
 * modified. NEVER-GUESS in spirit: deterministic code rejects any pick
 * that is not literally in the user's list, and unsure rows stay blank —
 * a wrong topic is worse than a blank one.
 */
import type { GeminiController } from '../providers/controller'
import { geminiController } from '../providers/controller'
import type { ProviderFailure, VisionRequest } from '../providers/types'
import { db } from '../state/db'
import { getArtifact, putArtifact, recordRequestUsage } from '../state/runs'
import type { TopicItem } from '../state/types'
import { wasTruncated } from './calls'
import { isRecord, parseModelJson } from './json'
import { TOPIC_MATCH_PROMPT } from './topic-match-prompt'
import type { MergedRow } from './types'

export interface TopicMatch {
  /** Both blank when the model would be guessing. */
  topic: string
  subtopic: string
}

/** The `topic-matches` artifact: one match per row id, cached per chunk. */
export interface TopicMatchesArtifact {
  matches: Record<string, TopicMatch>
  matchedAt: number
}

export type MatchOutcome =
  | { ok: true; requestsMade: number }
  | { ok: false; failure: ProviderFailure }

export interface MatchOptions {
  controller?: GeminiController
  signal?: AbortSignal
  /** Rows per Gemini call — text-only, so larger than the solver's. */
  chunkSize?: number
  onProgress?: (chunksDone: number, chunkCount: number) => void
}

const DEFAULT_CHUNK_SIZE = 20
const MATCH_MAX_TOKENS = 8_192
// Topic/subtopic matching stays on gemini-3.1-flash-lite (owner decision
// 2026-07-22): the newer 3.5-flash-lite primary matched questions to topics
// less accurately here, and this is a text-only reasoning task where that
// judgement is the whole job. The engine's vision roles still default to
// 3.5-flash-lite; only this post-audit topic feature pins the older model.
export const TOPIC_MATCH_MODEL = 'gemini-3.1-flash-lite'

// ---------------------------------------------------------------- reading

/** The topic list this run was created with; undefined when topics were off. */
export async function readRunTopics(
  runId: string,
): Promise<TopicItem[] | undefined> {
  const artifact = await getArtifact(runId, 'topics-list')
  const json = artifact?.json
  if (!isRecord(json) || !Array.isArray(json.topics)) return undefined
  const topics = (json.topics as unknown[]).flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.topic === 'string' &&
    Array.isArray(entry.subtopics) &&
    (entry.subtopics as unknown[]).every(
      (subtopic) => typeof subtopic === 'string',
    )
      ? [{ topic: entry.topic, subtopics: entry.subtopics as string[] }]
      : [],
  )
  return topics.length > 0 ? topics : undefined
}

export async function readTopicMatches(
  runId: string,
): Promise<TopicMatchesArtifact | undefined> {
  const artifact = await getArtifact(runId, 'topic-matches')
  const json = artifact?.json
  if (!isRecord(json) || !isRecord(json.matches)) return undefined
  return json as unknown as TopicMatchesArtifact
}

/** Rows a match run would actually send — no cache entry yet. */
export function pendingMatchRows(
  rows: readonly MergedRow[],
  cached: TopicMatchesArtifact | undefined,
): MergedRow[] {
  return rows.filter((row) => cached?.matches[row.id] === undefined)
}

// ---------------------------------------------------------------- calls

function buildMatchRequest(
  rows: readonly MergedRow[],
  topics: readonly TopicItem[],
  previousError?: string,
): VisionRequest {
  const parts = [
    TOPIC_MATCH_PROMPT,
    '',
    'QUESTIONS:',
    JSON.stringify({
      rows: rows.map((row) => ({
        id: row.id,
        question: row.question,
        options: row.options,
      })),
    }),
    '',
    'TOPICS:',
    JSON.stringify({ topics }),
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
    modelId: TOPIC_MATCH_MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: MATCH_MAX_TOKENS,
      responseMimeType: 'application/json',
    },
  }
}

export interface ChunkValidation {
  /**
   * The whole response is unusable (not JSON, no `matches` array) — nothing
   * can be trusted, so the caller retries the entire request. Distinct from
   * a per-row failure, which loses only the offending row.
   */
  structuralError?: string
  /** Valid picks keyed by row id — a subset of the requested rows. */
  matches: Record<string, TopicMatch>
  /** Requested rows the model got wrong or omitted (retry these only). */
  invalidIds: string[]
  /** First per-row error, threaded back to the model as the retry hint. */
  firstError?: string
}

/**
 * Deterministic gate on one match response, evaluated PER ROW: a blank pick
 * is a valid "unsure", a listed topic (with a listed or blank subtopic) is
 * accepted, and anything else — an unlisted topic, a mismatched subtopic, a
 * missing row — is an invalid row that never becomes a label. One bad row
 * no longer discards its nineteen good neighbours (owner-approved
 * 2026-07-21): only structural garbage fails the whole response. The
 * prompt's promises are never trusted — this function is the enforcement.
 */
export function validateMatchChunk(
  text: string,
  rows: readonly MergedRow[],
  topics: readonly TopicItem[],
): ChunkValidation {
  const parsed = parseModelJson(text)
  if (parsed.error !== undefined) {
    return {
      structuralError: `response is not JSON: ${parsed.error}`,
      matches: {},
      invalidIds: rows.map((row) => row.id),
    }
  }
  if (!isRecord(parsed.value) || !Array.isArray(parsed.value.matches)) {
    return {
      structuralError: 'missing "matches" array',
      matches: {},
      invalidIds: rows.map((row) => row.id),
    }
  }
  const subtopicsByTopic = new Map(
    topics.map((entry) => [entry.topic, new Set(entry.subtopics)]),
  )
  // Index the model's entries by id; unknown ids (not requested) are simply
  // ignored rather than failing the response.
  const byId = new Map<string, Record<string, unknown>>()
  for (const entry of parsed.value.matches as unknown[]) {
    if (isRecord(entry) && typeof entry.id === 'string') byId.set(entry.id, entry)
  }
  const matches: Record<string, TopicMatch> = {}
  const invalidIds: string[] = []
  let firstError: string | undefined
  const fail = (id: string, reason: string) => {
    invalidIds.push(id)
    if (firstError === undefined) firstError = `row "${id}": ${reason}`
  }
  for (const row of rows) {
    const entry = byId.get(row.id)
    if (entry === undefined) {
      fail(row.id, 'no match returned')
      continue
    }
    const { topic, subtopic } = entry
    if (typeof topic !== 'string' || typeof subtopic !== 'string') {
      fail(row.id, 'topic and subtopic must be strings')
      continue
    }
    if (topic === '') {
      if (subtopic !== '') {
        fail(row.id, 'subtopic without a topic')
        continue
      }
      matches[row.id] = { topic: '', subtopic: '' }
      continue
    }
    const allowedSubtopics = subtopicsByTopic.get(topic)
    if (allowedSubtopics === undefined) {
      fail(row.id, `topic "${topic}" is not in the provided list`)
      continue
    }
    if (subtopic !== '' && !allowedSubtopics.has(subtopic)) {
      fail(row.id, `subtopic "${subtopic}" is not listed under "${topic}"`)
      continue
    }
    matches[row.id] = { topic, subtopic }
  }
  return { matches, invalidIds, firstError }
}

/** Merge one chunk's matches into the cached artifact (update-in-place). */
async function saveMatches(
  runId: string,
  matches: Record<string, TopicMatch>,
): Promise<void> {
  const artifact = await getArtifact(runId, 'topic-matches')
  if (artifact === undefined) {
    await putArtifact({
      runId,
      kind: 'topic-matches',
      json: { matches, matchedAt: Date.now() } satisfies TopicMatchesArtifact,
    })
    return
  }
  const current = (artifact.json as TopicMatchesArtifact | undefined)?.matches ?? {}
  await db.runArtifacts.update(artifact.id, {
    json: {
      matches: { ...current, ...matches },
      matchedAt: Date.now(),
    } satisfies TopicMatchesArtifact,
  })
}

/**
 * Matches the run's unlabeled rows in chunks, caching each chunk as it
 * lands (an abort or quota pause keeps everything already matched; retry
 * re-sends only rows with no cache entry). A run without a topics-list
 * snapshot is a successful no-op. Never touches `merged-rows` or the run's
 * status — extraction success and topic matching are independent.
 */
export async function matchRunTopics(
  runId: string,
  options: MatchOptions = {},
): Promise<MatchOutcome> {
  const controller = options.controller ?? geminiController
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const { signal, onProgress } = options

  const topics = await readRunTopics(runId)
  if (topics === undefined) return { ok: true, requestsMade: 0 }
  const merged = await getArtifact(runId, 'merged-rows')
  const rows = (merged?.json as MergedRow[] | undefined) ?? []
  const pending = pendingMatchRows(rows, await readTopicMatches(runId))
  const chunkCount = Math.ceil(pending.length / chunkSize)
  onProgress?.(0, chunkCount)

  let requestsMade = 0
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkRows = pending.slice(
      chunkIndex * chunkSize,
      (chunkIndex + 1) * chunkSize,
    )
    const accepted: Record<string, TopicMatch> = {}
    // Rows still needing a good pick — a retry re-sends only these, never
    // the neighbours that already validated.
    let remaining: readonly MergedRow[] = chunkRows
    let previousError: string | undefined
    // Exactly one retry, consumed only by INVALID CONTENT (worker idiom).
    for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt += 1) {
      const result = await controller.runGeminiRequest(
        buildMatchRequest(remaining, topics, previousError),
        { signal },
      )
      if (!result.ok) {
        await recordRequestUsage(runId)
        return { ok: false, failure: result }
      }
      await recordRequestUsage(runId, result.usage)
      requestsMade += 1

      if (wasTruncated(result.finishReason)) {
        previousError = 'your response was truncated; return fewer characters'
        continue
      }
      const validation = validateMatchChunk(result.text, remaining, topics)
      if (validation.structuralError !== undefined) {
        // Nothing usable came back — retry the whole remaining set as-is.
        previousError = validation.structuralError
        continue
      }
      Object.assign(accepted, validation.matches)
      remaining = remaining.filter((row) => accepted[row.id] === undefined)
      previousError = validation.firstError
    }

    // Whatever is still unresolved after the retry stays honestly blank; a
    // bad or missing row never becomes a label — but its neighbours survive.
    const matches: Record<string, TopicMatch> = { ...accepted }
    for (const row of remaining) matches[row.id] = { topic: '', subtopic: '' }
    await saveMatches(runId, matches)
    onProgress?.(chunkIndex + 1, chunkCount)
  }

  return { ok: true, requestsMade }
}

// ------------------------------------------------------ re-matching (review)

/**
 * Overwrites the run's `topics-list` snapshot with an edited taxonomy — the
 * post-run topics editor's persistence. The engine's `merged-rows` are never
 * touched; only the label taxonomy the matcher and export read changes.
 */
export async function writeRunTopics(
  runId: string,
  topics: readonly TopicItem[],
): Promise<void> {
  const artifact = await getArtifact(runId, 'topics-list')
  if (artifact === undefined) {
    await putArtifact({ runId, kind: 'topics-list', json: { topics } })
    return
  }
  await db.runArtifacts.update(artifact.id, { json: { topics } })
}

/**
 * Drops every cached match so the next `matchRunTopics` re-labels all rows —
 * used when the taxonomy changed under them (a renamed or removed topic
 * would otherwise leave stale picks that no longer exist in the list).
 */
export async function clearTopicMatches(runId: string): Promise<void> {
  const artifact = await getArtifact(runId, 'topic-matches')
  if (artifact !== undefined) await db.runArtifacts.delete(artifact.id)
}

/**
 * Post-run re-match: persist an edited taxonomy, discard the old matches,
 * and re-label every row against the new list. Clearing an empty list is a
 * valid outcome — the run then exports with no topic columns.
 */
export async function rematchRunTopics(
  runId: string,
  topics: readonly TopicItem[],
  options: MatchOptions = {},
): Promise<MatchOutcome> {
  await writeRunTopics(runId, topics)
  await clearTopicMatches(runId)
  return matchRunTopics(runId, options)
}

// ---------------------------------------------------------------- applying

/**
 * Writes saved matches into the exportable rows' topic/subtopic cells —
 * pure, deterministic, used only by the exporter when the run has a topic
 * list. Every row is rewritten: unmatched rows get blanks, so planner
 * heading text never leaks into the user's taxonomy columns.
 */
export function applyTopicMatches(
  rows: readonly MergedRow[],
  matches: TopicMatchesArtifact | undefined,
): MergedRow[] {
  return rows.map((row) => {
    const match = matches?.matches[row.id]
    return {
      ...row,
      topic: match?.topic ?? '',
      subtopic: match?.subtopic ?? '',
    }
  })
}
