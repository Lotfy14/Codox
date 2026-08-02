import { bytesToBase64, blobToBytes } from '../../../src/providers/base64'
import { geminiController, type GeminiController } from '../../../src/providers/controller'
import { otherEngineModel } from '../../../src/providers/gemini'
import type { ProviderFailureCode, VisionResult } from '../../../src/providers/types'
import { bitmapToJpeg, decodeImageToBitmap, isImageMime } from '../../../src/pdf/images'
import { processPdf } from '../../../src/pdf/pipeline'
import { clearArtifacts, getArtifacts, getPageArtifact, putArtifact, recordRequestUsage, updateRun } from '../../../src/state/runs'
import { logEvent } from '../../../src/state/diagnostics'
import { emitCsv } from '../../Gold/engine/csv'
import { hasPositiveExtent, isBox2d } from '../../Gold/engine/boxes'
import { mapConcurrent } from '../../Gold/engine/concurrency'
import { parseModelJson, isRecord, isStringArray } from '../../Gold/engine/json'
import type { Box2d, ExamQuestion } from '../../Gold/engine/types'
import { DEFAULT_PYRITE_MODELS, type PyriteModels } from './model-steps'

const JPEG = 'image/jpeg'
// Page-level requests make a cross-page option list explicit, while bounded
// concurrency keeps the fast path responsive without flooding the provider.
const CALL_CONCURRENCY = 5
const CORE_PAGES_PER_REQUEST = 2

export interface ExecutorOptions {
  controller?: GeminiController
  signal?: AbortSignal
  dpi?: number
  reinitEvery?: number
  examPageCount?: number
  answerKeyBytes?: Uint8Array
  answerKeyPageCount?: number
  answerKeyMimeType?: string
  models?: Partial<PyriteModels>
}

type Outcome =
  | { status: 'done'; runId: string; csv: string; flaggedRows: number; notSafeToImport: boolean }
  | { status: 'stopped'; runId: string; reason: string }
  | { status: 'provider-stopped'; runId: string; kind: 'wrong-key' | 'provider-error' }
  | { status: 'aborted'; runId: string }

type ParsedRow = {
  label: string
  sourcePages: number[]
  question: string
  options: string[]
  correctIndex: string
  needsReview: string
  continuation: boolean
  sourceBox: Box2d | null
}

type KeyAnswer = { label: string; correctIndex: string; needsReview: string }

class ProviderStop extends Error {
  readonly kind: 'wrong-key' | 'provider-error' | 'aborted'
  readonly code?: ProviderFailureCode

  constructor(
    kind: 'wrong-key' | 'provider-error' | 'aborted',
    code?: ProviderFailureCode,
  ) {
    super(`provider stop: ${kind}`)
    this.kind = kind
    this.code = code
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positivePages(value: unknown, maximum: number): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((page): page is number =>
    typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= maximum,
  ))]
}

function validIndex(value: string, optionCount: number): boolean {
  return value === '' || (/^\d+$/.test(value) && Number(value) < optionCount)
}

function sourceBox(value: unknown): Box2d | null {
  if (!isBox2d(value) || !hasPositiveExtent(value)) return null
  return value.every((edge) => edge >= 0 && edge <= 1000) ? value : null
}

/** Review draws the A/B/C/D badge itself; keep only the option's text. */
function optionText(value: string): string {
  return value.trim().replace(/^[A-Za-z][.)\-:]\s*/, '').trim()
}

function parseRows(value: unknown, maximumPage: number): ParsedRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.rows)) return undefined
  const rows: ParsedRow[] = []
  for (const raw of value.rows) {
    if (!isRecord(raw)) continue
    const question = text(raw.question)
    const options = isStringArray(raw.options) ? raw.options.map(optionText).filter(Boolean) : []
    const label = text(raw.label)
    let needsReview = text(raw.needs_review)
    let correctIndex = text(raw.correct_index)
    if (question === '') needsReview ||= 'empty_question'
    if (options.length < 2) needsReview ||= 'incomplete_options'
    if (!validIndex(correctIndex, options.length)) {
      correctIndex = ''
      needsReview ||= 'index_out_of_range'
    }
    if (correctIndex === '') needsReview ||= 'no_visible_answer'
    rows.push({
      label,
      sourcePages: positivePages(raw.source_pages, maximumPage),
      question,
      options,
      correctIndex,
      needsReview,
      continuation: raw.continuation === true,
      sourceBox: sourceBox(raw.box_2d),
    })
  }
  return rows
}

function parseKey(value: unknown): KeyAnswer[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.answers)) return undefined
  return value.answers.flatMap((raw) => {
    if (!isRecord(raw)) return []
    const label = text(raw.label)
    const correctIndex = text(raw.correct_index)
    return label === '' ? [] : [{ label, correctIndex, needsReview: text(raw.needs_review) }]
  })
}

function requestPrompt(mode: 'exam' | 'key', firstPage: number, lastPage: number, coreLastPage = lastPage): string {
  if (mode === 'key') return [
    'Read this answer-key page window. Return JSON only: {"answers":[{"label":"printed question number","correct_index":"zero-based option index or empty","needs_review":""}]}.',
    'Do not infer an answer. Return an empty correct_index and a reason when a mark is unclear. Do not return question text.',
    `The images are answer-key pages ${firstPage} through ${lastPage}.`,
  ].join('\n')
  return [
    'Read these exam pages and return JSON only: {"rows":[{"label":"printed question number or empty","source_pages":[1],"question":"verbatim question text","options":["choice text"],"correct_index":"zero-based visible answer or empty","needs_review":"","continuation":false,"box_2d":[ymin,xmin,ymax,xmax]}]}.',
    `Extract every question that starts on core pages ${firstPage} through ${coreLastPage}; page ${coreLastPage + 1} may be included only as a look-ahead for options that continue from a core page. Keep question text and choices verbatim. Never infer an answer from subject knowledge.`,
    'For EACH question, inspect every option row for answer evidence: especially a coloured highlighter stroke (including yellow), a tick, circle, underline, strike-through, or a letter written beside the option/question. A single clear highlight on an option IS visible answer evidence: return that option\'s zero-based correct_index. Do not copy the highlight into option text. If marks identify multiple options, are too faint, or are absent, leave correct_index empty and give a concise needs_review reason.',
    'Some papers place one large handwritten answer letter beside each question in an outer page margin rather than on an option. Read that ordered margin column from top to bottom and map each letter to the question aligned with it; it is visible answer evidence, not a subject-knowledge answer.',
    'For every normal question return box_2d as a tight normalized [ymin,xmin,ymax,xmax] box in 0–1000 page coordinates. Include its printed number, full stem, every option, and the nearby answer mark; use the image edges only when the question truly touches them. This box is for Review display only and does not change extraction.',
    'Use an empty correct_index and a concise needs_review reason for unclear text, continuations, diagrams, tables, or ambiguous answer marks.',
    'A question whose choices continue beyond this page must be retained and flagged options_cut_at_page_break. If this page begins with choices that complete a question from the preceding page, emit one row before normal questions with label and question empty, those continued choices in options, and continuation:true. Do not omit those choices or turn them into a new question.',
    `The images are exam pages ${firstPage} through ${lastPage}; source_pages uses these document page numbers.`,
  ].join('\n')
}

async function call(
  controller: GeminiController,
  runId: string,
  prompt: string,
  images: { mimeType: string; base64Data: string }[],
  model: string,
  signal?: AbortSignal,
): Promise<{ text: string; finishReason?: string }> {
  const result: VisionResult = await controller.runGeminiRequest({
    prompt,
    images,
    modelId: model,
    fallbackModelId: otherEngineModel(model),
    generationConfig: { temperature: 0, maxOutputTokens: 32_768, responseMimeType: 'application/json' },
  }, { signal })
  if (!result.ok) {
    await recordRequestUsage(runId)
    throw new ProviderStop(result.kind === 'wrong-key' ? 'wrong-key' : result.kind === 'aborted' ? 'aborted' : 'provider-error', result.code)
  }
  await recordRequestUsage(runId, result.usage)
  return { text: result.text, finishReason: result.finishReason }
}

async function renderDocument(
  runId: string,
  bytes: Uint8Array,
  offset: number,
  options: ExecutorOptions,
): Promise<{ pageCount: number; complete: boolean }> {
  const result = await processPdf(bytes, async (page) => {
    await putArtifact({ runId, kind: 'page-jpeg', pageIndex: offset + page.pageIndex, width: page.width, height: page.height, bytes: await blobToBytes(page.jpeg) })
    if (page.text !== '') await putArtifact({ runId, kind: 'page-text', pageIndex: offset + page.pageIndex, text: page.text })
  }, { dpi: options.dpi, reinitEvery: options.reinitEvery, signal: options.signal })
  return { pageCount: result.pageCount, complete: result.failures.length === 0 }
}

async function render(runId: string, pdfBytes: Uint8Array, options: ExecutorOptions): Promise<{ examPages: number; keyPages: number; complete: boolean }> {
  const existing = await getArtifacts(runId, 'page-jpeg')
  const expected = (options.examPageCount ?? 0) + (options.answerKeyPageCount ?? 0)
  if (existing.length > 0 && expected > 0 && existing.length >= expected) {
    return { examPages: options.examPageCount ?? existing.length, keyPages: options.answerKeyPageCount ?? 0, complete: true }
  }
  if (existing.length > 0) {
    await clearArtifacts(runId, 'page-jpeg')
    await clearArtifacts(runId, 'page-text')
  }
  const exam = await renderDocument(runId, pdfBytes, 0, options)
  if (!exam.complete) return { examPages: exam.pageCount, keyPages: 0, complete: false }
  if (options.answerKeyBytes === undefined) return { examPages: exam.pageCount, keyPages: 0, complete: true }
  if (options.answerKeyMimeType !== undefined && isImageMime(options.answerKeyMimeType)) {
    const bitmap = await decodeImageToBitmap(options.answerKeyBytes, options.answerKeyMimeType)
    const jpeg = await bitmapToJpeg(bitmap)
    await putArtifact({ runId, kind: 'page-jpeg', pageIndex: exam.pageCount, width: bitmap.width, height: bitmap.height, bytes: await blobToBytes(jpeg) })
    return { examPages: exam.pageCount, keyPages: 1, complete: true }
  }
  const key = await renderDocument(runId, options.answerKeyBytes, exam.pageCount, options)
  return { examPages: exam.pageCount, keyPages: key.pageCount, complete: key.complete }
}

async function imagesFor(runId: string, indexes: readonly number[]) {
  const images: { mimeType: string; base64Data: string }[] = []
  for (const index of indexes) {
    const page = await getPageArtifact(runId, index)
    if (page?.bytes !== undefined) images.push({ mimeType: JPEG, base64Data: bytesToBase64(page.bytes) })
  }
  return images
}

/** Joins an option list that starts at the top of a page to its prior stem. */
export function stitchContinuations(rows: readonly ParsedRow[]): ParsedRow[] {
  const output: ParsedRow[] = []
  for (const row of rows) {
    if (!row.continuation) {
      output.push(row)
      continue
    }
    const page = row.sourcePages[0]
    const priorIndex = page === undefined ? -1 : output.findLastIndex((candidate) =>
      !candidate.continuation && candidate.sourcePages.includes(page - 1),
    )
    const prior = output[priorIndex]
    if (prior === undefined) {
      output.push({ ...row, needsReview: row.needsReview || 'orphaned_page_continuation' })
      continue
    }
    const optionOffset = prior.options.length
    const continuedAnswer = row.correctIndex === '' ? '' : String(optionOffset + Number(row.correctIndex))
    const reasons = [prior.needsReview, row.needsReview]
      .filter((reason) => !['empty_question', 'incomplete_options', 'no_visible_answer', 'options_cut_at_page_break'].includes(reason))
    const correctIndex = prior.correctIndex || continuedAnswer
    output[priorIndex] = {
      ...prior,
      sourcePages: [...new Set([...prior.sourcePages, ...row.sourcePages])],
      options: [...prior.options, ...row.options],
      correctIndex,
      needsReview: reasons[0] ?? (correctIndex === '' ? 'no_visible_answer' : ''),
      sourceBox: prior.sourceBox,
    }
  }
  return output
}

function normalizedContent(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function dedupe(rows: readonly ParsedRow[]): ExamQuestion[] {
  const output = new Map<string, ExamQuestion>()
  const keyByLabel = new Map<string, string>()
  const keyByContent = new Map<string, string>()
  for (const [index, row] of rows.entries()) {
    const candidate: ExamQuestion = {
      // Keep the document's visible label when it exists. Gold does the same,
      // and shared benchmark truth is intentionally keyed by that label.
      id: row.label || `pyrite-${index + 1}`,
      topic: '', subtopic: '', year: '', question: row.question, options: row.options,
      correct_index: row.correctIndex, image_urls: [], needs_review: row.needsReview,
      ...(row.sourcePages[0] === undefined ? {} : { source_page: row.sourcePages[0] }),
      ...(row.sourceBox === null ? {} : { source_box: row.sourceBox }),
    }
    // Look-ahead images can make the next bundle report a question twice.
    // Its label may be omitted or re-read differently, so labels alone cannot
    // safely recognize the duplicate. Exact normalized content is stable while
    // still allowing genuinely distinct questions with different choices.
    const contentKey = `${normalizedContent(candidate.question)}\u0000${candidate.options.map(normalizedContent).join('\u0000')}`
    const key = (candidate.id !== '' ? keyByLabel.get(candidate.id) : undefined) ??
      keyByContent.get(contentKey) ??
      (candidate.id !== '' ? `label:${candidate.id}` : `content:${contentKey}`)
    const prior = output.get(key)
    const candidateScore = candidate.question.length + candidate.options.join('').length + (candidate.correct_index === '' ? 0 : 1_000_000)
    const priorScore = prior === undefined ? -1 : prior.question.length + prior.options.join('').length + (prior.correct_index === '' ? 0 : 1_000_000)
    if (candidateScore > priorScore) {
      output.set(key, candidate)
    }
    if (candidate.id !== '') keyByLabel.set(candidate.id, key)
    keyByContent.set(contentKey, key)
  }
  return [...output.values()]
}

export async function executeRun(runId: string, pdfBytes: Uint8Array, options: ExecutorOptions = {}): Promise<Outcome> {
  const controller = options.controller ?? geminiController
  const model = options.models?.extract ?? DEFAULT_PYRITE_MODELS.extract
  try {
    await updateRun(runId, { status: 'running', step: 'render', stepStartedAt: Date.now() })
    const { examPages, keyPages, complete } = await render(runId, pdfBytes, options)
    const rendered = await getArtifacts(runId, 'page-jpeg')
    if (!complete || examPages === 0 || rendered.length < examPages + keyPages) {
      await updateRun(runId, { status: 'stopped', stopReason: 'render_failed' })
      return { status: 'stopped', runId, reason: 'render_failed' }
    }
    const extracted: ParsedRow[] = []
    const answers = new Map<string, KeyAnswer>()
    let requestCount = 0
    for (const mode of ['exam', 'key'] as const) {
      const count = mode === 'exam' ? examPages : keyPages
      const offset = mode === 'exam' ? 0 : examPages
      const pageResults = await mapConcurrent(
        Array.from({ length: Math.ceil(count / CORE_PAGES_PER_REQUEST) }, (_, index) => index * CORE_PAGES_PER_REQUEST),
        CALL_CONCURRENCY,
        async (start) => {
        await updateRun(runId, { step: mode === 'exam' ? 'extract' : 'answer-key', stepStartedAt: Date.now() })
        const coreLast = Math.min(count, start + CORE_PAGES_PER_REQUEST)
        const visibleLast = mode === 'exam' ? Math.min(count, coreLast + 1) : coreLast
        const images = await imagesFor(runId, Array.from({ length: visibleLast - start }, (_, index) => offset + start + index))
        let requests = 1
        let response = await call(controller, runId, requestPrompt(mode, start + 1, visibleLast, coreLast), images, model, options.signal)
        let parsed = response.finishReason === 'MAX_TOKENS' ? undefined : parseModelJson(response.text).value
        let rows = mode === 'exam' ? parseRows(parsed, examPages) : parseKey(parsed)
        // A malformed or truncated JSON response used to be treated as an
        // empty page, silently dropping every question on it. One focused
        // retry costs an extra request only when the original result cannot
        // be used; a second invalid response stops the run for Review rather
        // than exporting a partial exam as if it were complete.
        if (rows === undefined) {
          const retryPrompt = `${requestPrompt(mode, start + 1, visibleLast, coreLast)}\nRETRY: Return complete valid JSON for every numbered question starting on the core pages. Do not include a partial object or prose.`
          response = await call(controller, runId, retryPrompt, images, model, options.signal)
          requests++
          parsed = response.finishReason === 'MAX_TOKENS' ? undefined : parseModelJson(response.text).value
          rows = mode === 'exam' ? parseRows(parsed, examPages) : parseKey(parsed)
          if (rows === undefined) {
            await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response: response.text, invalid: true } })
            return { start, coreLast, rows: undefined, requests }
          }
        }
        await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response: response.text } })
        return { start, coreLast, rows, requests }
        },
      )
      for (const result of pageResults) {
        requestCount += result.requests
        if (result.rows === undefined) {
          await updateRun(runId, { status: 'stopped', stopReason: 'extract_invalid' })
          return { status: 'stopped', runId, reason: 'extract_invalid' }
        }
        if (mode === 'exam') extracted.push(...(result.rows as ParsedRow[]))
        else for (const answer of result.rows as KeyAnswer[]) answers.set(answer.label, answer)
      }
    }
    let rows = dedupe(stitchContinuations(extracted).map((row) => {
      const answer = answers.get(row.label)
      if (answer === undefined || row.correctIndex !== '') return row
      if (!validIndex(answer.correctIndex, row.options.length)) {
        return { ...row, needsReview: answer.needsReview || 'key_unclear' }
      }
      return {
        ...row,
        correctIndex: answer.correctIndex,
        needsReview: answer.needsReview,
      }
    }))
    await putArtifact({ runId, kind: 'merged-rows', json: rows })
    const csv = emitCsv(rows)
    await putArtifact({ runId, kind: 'csv', text: csv })
    const flaggedRows = rows.filter((row) => row.needs_review !== '').length
    await updateRun(runId, { status: 'done', step: 'emit', flaggedRows, notSafeToImport: true, auditUnavailable: true })
    await logEvent({ scope: 'engine', level: 'warn', event: 'pyrite.done', runId, detail: { rows: rows.length, flaggedRows, pageConcurrency: CALL_CONCURRENCY, requests: requestCount } })
    return { status: 'done', runId, csv, flaggedRows, notSafeToImport: true }
  } catch (error) {
    if (error instanceof ProviderStop) {
      if (error.kind === 'aborted') {
        await updateRun(runId, { status: 'paused' })
        return { status: 'aborted', runId }
      }
      await updateRun(runId, { status: 'stopped', stopReason: error.code ?? error.kind })
      return { status: 'provider-stopped', runId, kind: error.kind }
    }
    await updateRun(runId, { status: 'stopped', stopReason: 'unexpected_error' })
    throw error
  }
}
