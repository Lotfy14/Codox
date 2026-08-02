import { bytesToBase64, blobToBytes } from '../../../src/providers/base64'
import { geminiController, type GeminiController } from '../../../src/providers/controller'
import { otherEngineModel } from '../../../src/providers/gemini'
import type { ProviderFailureCode, VisionResult } from '../../../src/providers/types'
import { bitmapToJpeg, decodeImageToBitmap, isImageMime } from '../../../src/pdf/images'
import { processPdf } from '../../../src/pdf/pipeline'
import { clearArtifacts, getArtifacts, getPageArtifact, putArtifact, recordRequestUsage, updateRun } from '../../../src/state/runs'
import { logEvent } from '../../../src/state/diagnostics'
import { emitCsv } from '../../Gold/engine/csv'
import { parseModelJson, isRecord, isStringArray } from '../../Gold/engine/json'
import type { ExamQuestion } from '../../Gold/engine/types'
import { DEFAULT_PYRITE_MODELS, type PyriteModels } from './model-steps'

const JPEG = 'image/jpeg'
// Two ordinary pages hold roughly 15–25 MCQs. Four proved fast but allowed
// otherwise-valid responses to omit a whole page's questions, so two is the
// fast/reliable compromise; oversized scans are still isolated below.
const WINDOW_PAGES = 2

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

function parseRows(value: unknown, maximumPage: number): ParsedRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.rows)) return undefined
  const rows: ParsedRow[] = []
  for (const raw of value.rows) {
    if (!isRecord(raw)) continue
    const question = text(raw.question)
    const options = isStringArray(raw.options) ? raw.options.map((option) => option.trim()).filter(Boolean) : []
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

function requestPrompt(mode: 'exam' | 'key', firstPage: number, lastPage: number): string {
  if (mode === 'key') return [
    'Read this answer-key page window. Return JSON only: {"answers":[{"label":"printed question number","correct_index":"zero-based option index or empty","needs_review":""}]}.',
    'Do not infer an answer. Return an empty correct_index and a reason when a mark is unclear. Do not return question text.',
    `The images are answer-key pages ${firstPage} through ${lastPage}.`,
  ].join('\n')
  return [
    'Read these exam pages and return JSON only: {"rows":[{"label":"printed question number or empty","source_pages":[1],"question":"verbatim question text","options":["choice text"],"correct_index":"zero-based visible answer or empty","needs_review":""}]}.',
    'Extract every question that starts in these images. Keep question text and choices verbatim. Never infer an answer from subject knowledge.',
    'For EACH question, inspect every option row for answer evidence: especially a coloured highlighter stroke (including yellow), a tick, circle, underline, strike-through, or a letter written beside the option/question. A single clear highlight on an option IS visible answer evidence: return that option\'s zero-based correct_index. Do not copy the highlight into option text. If marks identify multiple options, are too faint, or are absent, leave correct_index empty and give a concise needs_review reason.',
    'Some papers place one large handwritten answer letter beside each question in an outer page margin rather than on an option. Read that ordered margin column from top to bottom and map each letter to the question aligned with it; it is visible answer evidence, not a subject-knowledge answer.',
    'Use an empty correct_index and a concise needs_review reason for unclear text, continuations, diagrams, tables, or ambiguous answer marks.',
    'A question whose choices continue beyond this window must be retained and flagged options_cut_at_page_break.',
    `The images are exam pages ${firstPage} through ${lastPage}; source_pages uses these document page numbers.`,
  ].join('\n')
}

function answerRescuePrompt(page: number, labels: readonly string[]): string {
  return [
    'Recheck the listed questions on this single exam page. Return JSON only: {"answers":[{"label":"printed question number","correct_index":"zero-based option index or empty","needs_review":""}]}.',
    'This is an answer-mark pass, not a medical question. Inspect every option for visible marking evidence. A single yellow (or other coloured) highlighter stroke over an option is the selected answer, even if no circle or tick is present. Also accept a handwritten margin letter aligned with the question.',
    'Never infer an answer from subject knowledge. Return empty only when the visible mark is genuinely absent or ambiguous.',
    `This is document page ${page}. Recheck exactly these question labels: ${labels.join(', ')}.`,
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

function dedupe(rows: readonly ParsedRow[]): ExamQuestion[] {
  const output = new Map<string, ExamQuestion>()
  for (const [index, row] of rows.entries()) {
    const key = row.label === '' ? `${row.sourcePages.join('-')}:${row.question.slice(0, 80)}` : row.label
    const candidate: ExamQuestion = {
      // Keep the document's visible label when it exists. Gold does the same,
      // and shared benchmark truth is intentionally keyed by that label.
      id: row.label || `pyrite-${index + 1}`,
      topic: '', subtopic: '', year: '', question: row.question, options: row.options,
      correct_index: row.correctIndex, image_urls: [], needs_review: row.needsReview,
      ...(row.sourcePages[0] === undefined ? {} : { source_page: row.sourcePages[0] }),
    }
    const prior = output.get(key)
    if (prior === undefined || candidate.question.length + candidate.options.join('').length > prior.question.length + prior.options.join('').length) {
      output.set(key, candidate)
    }
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
    // Some scanned PDFs still yield oversized JPEGs. Four such pages in one
    // vision request can exceed the provider's practical response window. Keep the
    // normal four-page budget for ordinary pages, but isolate oversized scans.
    const windowPages = rendered.some((page) =>
      Math.max(page.width ?? 0, page.height ?? 0) > 3_000,
    ) ? 1 : WINDOW_PAGES
    const extracted: ParsedRow[] = []
    const answers = new Map<string, KeyAnswer>()
    let requestCount = 0
    for (const mode of ['exam', 'key'] as const) {
      const count = mode === 'exam' ? examPages : keyPages
      const offset = mode === 'exam' ? 0 : examPages
      for (let start = 0; start < count; start += windowPages) {
        const end = Math.min(count, start + windowPages)
        await updateRun(runId, { step: mode === 'exam' ? 'extract' : 'answer-key', stepStartedAt: Date.now() })
        const images = await imagesFor(runId, Array.from({ length: end - start }, (_, i) => offset + start + i))
        let response = await call(controller, runId, requestPrompt(mode, start + 1, end), images, model, options.signal)
        requestCount++
        let parsed = response.finishReason === 'MAX_TOKENS' ? undefined : parseModelJson(response.text).value
        let rows = mode === 'exam' ? parseRows(parsed, examPages) : parseKey(parsed)
        // A malformed or truncated JSON response used to be treated as an
        // empty page, silently dropping every question on it. One focused
        // retry costs an extra request only when the original result cannot
        // be used; a second invalid response stops the run for Review rather
        // than exporting a partial exam as if it were complete.
        if (rows === undefined) {
          const retryPrompt = `${requestPrompt(mode, start + 1, end)}\nRETRY: Your previous response was incomplete. Return complete valid JSON for every numbered question visible in this page window. Do not include a partial object or prose.`
          response = await call(controller, runId, retryPrompt, images, model, options.signal)
          requestCount++
          parsed = response.finishReason === 'MAX_TOKENS' ? undefined : parseModelJson(response.text).value
          rows = mode === 'exam' ? parseRows(parsed, examPages) : parseKey(parsed)
          if (rows === undefined) {
            await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response: response.text, invalid: true } })
            await updateRun(runId, { status: 'stopped', stopReason: 'extract_invalid' })
            return { status: 'stopped', runId, reason: 'extract_invalid' }
          }
        }
        await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response: response.text } })
        if (mode === 'exam') {
          extracted.push(...(rows as ParsedRow[]))
        } else {
          for (const answer of rows as KeyAnswer[]) answers.set(answer.label, answer)
        }
      }
    }
    let rows = dedupe(extracted.map((row) => {
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
    // Extraction keeps the main path fast. If it left any questions blank,
    // recheck only those source pages with an answer-focused prompt. This is
    // especially effective for a light yellow highlighter that can be easy to
    // miss while transcribing the surrounding question text.
    const blanksByPage = new Map<number, ExamQuestion[]>()
    for (const row of rows) {
      if (row.correct_index !== '' || row.source_page === undefined || row.id === '') continue
      const group = blanksByPage.get(row.source_page) ?? []
      group.push(row)
      blanksByPage.set(row.source_page, group)
    }
    for (const [page, blankRows] of blanksByPage) {
      const response = await call(controller, runId, answerRescuePrompt(page, blankRows.map((row) => row.id)), await imagesFor(runId, [page - 1]), model, options.signal)
      requestCount++
      const recovered = response.finishReason === 'MAX_TOKENS' ? undefined : parseKey(parseModelJson(response.text).value)
      if (recovered === undefined) continue
      const byLabel = new Map(recovered.map((answer) => [answer.label, answer]))
      rows = rows.map((row) => {
        const answer = byLabel.get(row.id)
        if (row.correct_index !== '' || answer === undefined || !validIndex(answer.correctIndex, row.options.length)) return row
        return { ...row, correct_index: answer.correctIndex, needs_review: answer.needsReview }
      })
    }
    await putArtifact({ runId, kind: 'merged-rows', json: rows })
    const csv = emitCsv(rows)
    await putArtifact({ runId, kind: 'csv', text: csv })
    const flaggedRows = rows.filter((row) => row.needs_review !== '').length
    await updateRun(runId, { status: 'done', step: 'emit', flaggedRows, notSafeToImport: true, auditUnavailable: true })
    await logEvent({ scope: 'engine', level: 'warn', event: 'pyrite.done', runId, detail: { rows: rows.length, flaggedRows, windowPages, requests: requestCount } })
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
