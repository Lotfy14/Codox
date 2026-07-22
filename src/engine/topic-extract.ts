/**
 * Topics-document extraction — one Gemini call that reads the user's
 * uploaded topics PDF or image into the structured `TopicItem[]` list the
 * editor shows and the matcher consumes. Outside the pinned engine path
 * (new surface, like `solver.ts`). The result always lands in the editor
 * for the user to check — extraction proposes, the user disposes.
 */
import { blobToBase64, bytesToBase64 } from '../providers/base64'
import type { GeminiController } from '../providers/controller'
import { geminiController } from '../providers/controller'
import type { ProviderFailure, VisionRequest } from '../providers/types'
import type { TopicItem } from '../state/types'
import { wasTruncated } from './calls'
import { isRecord, isStringArray, parseModelJson } from './json'
import { TOPIC_EXTRACT_PROMPT } from './topic-extract-prompt'

export type ExtractOutcome =
  | { ok: true; topics: TopicItem[] }
  | { ok: false; failure: ProviderFailure }
  | { ok: false; invalid: true }

export interface ExtractOptions {
  controller?: GeminiController
  signal?: AbortSignal
}

const EXTRACT_MAX_TOKENS = 8_192
export const TOPIC_EXTRACT_MODEL = 'gemini-3.5-flash-lite'

/** Sanity caps — a topics list, not an encyclopedia. */
const MAX_TOPICS = 300
const MAX_SUBTOPICS = 50

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function isTopicsImage(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType)
}

/**
 * Deterministic cleanup of the model's transcription: strings only,
 * trimmed, empties dropped, duplicates removed, capped. Returns undefined
 * when the response shape is wrong (the caller's retry signal).
 */
export function narrowExtractedTopics(value: unknown): TopicItem[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.topics)) return undefined
  const seen = new Set<string>()
  const topics: TopicItem[] = []
  for (const entry of value.topics as unknown[]) {
    if (!isRecord(entry) || typeof entry.topic !== 'string') return undefined
    if (!isStringArray(entry.subtopics)) return undefined
    const topic = entry.topic.trim()
    if (topic === '' || seen.has(topic)) continue
    seen.add(topic)
    const subtopicsSeen = new Set<string>()
    const subtopics: string[] = []
    for (const raw of entry.subtopics) {
      const subtopic = raw.trim()
      if (subtopic === '' || subtopicsSeen.has(subtopic)) continue
      subtopicsSeen.add(subtopic)
      subtopics.push(subtopic)
      if (subtopics.length >= MAX_SUBTOPICS) break
    }
    topics.push({ topic, subtopics })
    if (topics.length >= MAX_TOPICS) break
  }
  return topics
}

/** The document's pages as request images — PDF rendered, image as-is. */
async function documentImages(
  bytes: Uint8Array,
  mimeType: string,
): Promise<VisionRequest['images']> {
  if (isTopicsImage(mimeType)) {
    return [{ mimeType, base64Data: bytesToBase64(bytes) }]
  }
  // Page-at-a-time render (memory discipline); topics docs are short, so
  // holding their encoded JPEGs for one request stays tiny.
  const { processPdf } = await import('../pdf')
  const images: Array<{ mimeType: string; base64Data: string }> = []
  await processPdf(bytes, async (page) => {
    images.push({
      mimeType: 'image/jpeg',
      base64Data: await blobToBase64(page.jpeg),
    })
  })
  return images
}

function buildExtractRequest(
  images: VisionRequest['images'],
  previousError?: string,
): VisionRequest {
  const parts = [TOPIC_EXTRACT_PROMPT]
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
    images,
    modelId: TOPIC_EXTRACT_MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: EXTRACT_MAX_TOKENS,
      responseMimeType: 'application/json',
    },
  }
}

/**
 * Reads the topics document with one Gemini call (plus one repair retry on
 * invalid content, worker idiom). `invalid` means Gemini answered but no
 * valid topic list came back — the user can still type the list by hand.
 */
export async function extractTopicsFromDocument(
  input: { bytes: Uint8Array; mimeType: string },
  options: ExtractOptions = {},
): Promise<ExtractOutcome> {
  const controller = options.controller ?? geminiController
  const images = await documentImages(input.bytes, input.mimeType)
  if (images.length === 0) return { ok: false, invalid: true }

  let previousError: string | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await controller.runGeminiRequest(
      buildExtractRequest(images, previousError),
      { signal: options.signal },
    )
    if (!result.ok) return { ok: false, failure: result }
    if (wasTruncated(result.finishReason)) {
      previousError = 'your response was truncated; return fewer characters'
      continue
    }
    const parsed = parseModelJson(result.text)
    if (parsed.error !== undefined) {
      previousError = `response is not JSON: ${parsed.error}`
      continue
    }
    const topics = narrowExtractedTopics(parsed.value)
    if (topics !== undefined) return { ok: true, topics }
    previousError = 'response does not match {"topics": [{"topic", "subtopics"}]}'
  }
  return { ok: false, invalid: true }
}
