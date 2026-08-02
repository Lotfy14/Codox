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
const WINDOW_PAGES = 4

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
    'Extract every question that starts in these images. Keep question text and choices verbatim. Never infer an answer. Use an empty correct_index and a concise needs_review reason for unclear text, continuations, diagrams, tables, or ambiguous answer marks.',
    'A question whose choices continue beyond this window must be retained and flagged options_cut_at_page_break.',
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
): Promise<string> {
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
  return result.text
}

async function renderDocument(
  runId: string,
  bytes: Uint8Array,
  offset: number,
  options: ExecutorOptions,
): Promise<number> {
  const result = await processPdf(bytes, async (page) => {
    await putArtifact({ runId, kind: 'page-jpeg', pageIndex: offset + page.pageIndex, width: page.width, height: page.height, bytes: await blobToBytes(page.jpeg) })
    if (page.text !== '') await putArtifact({ runId, kind: 'page-text', pageIndex: offset + page.pageIndex, text: page.text })
  }, { dpi: options.dpi, reinitEvery: options.reinitEvery, signal: options.signal })
  return result.pageCount
}

async function render(runId: string, pdfBytes: Uint8Array, options: ExecutorOptions): Promise<{ examPages: number; keyPages: number }> {
  const existing = await getArtifacts(runId, 'page-jpeg')
  const expected = (options.examPageCount ?? 0) + (options.answerKeyPageCount ?? 0)
  if (existing.length > 0 && expected > 0 && existing.length >= expected) {
    return { examPages: options.examPageCount ?? existing.length, keyPages: options.answerKeyPageCount ?? 0 }
  }
  if (existing.length > 0) {
    await clearArtifacts(runId, 'page-jpeg')
    await clearArtifacts(runId, 'page-text')
  }
  const examPages = await renderDocument(runId, pdfBytes, 0, options)
  if (options.answerKeyBytes === undefined) return { examPages, keyPages: 0 }
  if (options.answerKeyMimeType !== undefined && isImageMime(options.answerKeyMimeType)) {
    const bitmap = await decodeImageToBitmap(options.answerKeyBytes, options.answerKeyMimeType)
    const jpeg = await bitmapToJpeg(bitmap)
    await putArtifact({ runId, kind: 'page-jpeg', pageIndex: examPages, width: bitmap.width, height: bitmap.height, bytes: await blobToBytes(jpeg) })
    return { examPages, keyPages: 1 }
  }
  const keyPages = await renderDocument(runId, options.answerKeyBytes, examPages, options)
  return { examPages, keyPages }
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
    const { examPages, keyPages } = await render(runId, pdfBytes, options)
    if (examPages === 0) {
      await updateRun(runId, { status: 'stopped', stopReason: 'render_failed' })
      return { status: 'stopped', runId, reason: 'render_failed' }
    }
    const extracted: ParsedRow[] = []
    const answers = new Map<string, KeyAnswer>()
    for (const mode of ['exam', 'key'] as const) {
      const count = mode === 'exam' ? examPages : keyPages
      const offset = mode === 'exam' ? 0 : examPages
      for (let start = 0; start < count; start += WINDOW_PAGES) {
        const end = Math.min(count, start + WINDOW_PAGES)
        await updateRun(runId, { step: mode === 'exam' ? 'extract' : 'answer-key', stepStartedAt: Date.now() })
        const response = await call(controller, runId, requestPrompt(mode, start + 1, end), await imagesFor(runId, Array.from({ length: end - start }, (_, i) => offset + start + i)), model, options.signal)
        await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response } })
        const parsed = parseModelJson(response).value
        if (mode === 'exam') {
          const rows = parseRows(parsed, examPages)
          if (rows !== undefined) extracted.push(...rows)
        } else {
          const key = parseKey(parsed)
          if (key !== undefined) for (const answer of key) answers.set(answer.label, answer)
        }
      }
    }
    const rows = dedupe(extracted.map((row) => {
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
    await logEvent({ scope: 'engine', level: 'warn', event: 'pyrite.done', runId, detail: { rows: rows.length, flaggedRows, requests: Math.ceil(examPages / WINDOW_PAGES) + Math.ceil(keyPages / WINDOW_PAGES) } })
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
