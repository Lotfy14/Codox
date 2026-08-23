import { blobToBytes, bytesToBase64 } from '../../../src/providers/base64'
import { geminiController, type GeminiController } from '../../../src/providers/controller'
import { otherEngineModel } from '../../../src/providers/gemini'
import type { VisionResult } from '../../../src/providers/types'
import { bitmapToJpeg, cropJpeg, decodeImageToBitmap, isImageMime } from '../../../src/pdf/images'
import { processPdf } from '../../../src/pdf/pipeline'
import { clearArtifacts, clearCropArtifacts, getArtifacts, getCropByPath, getPageArtifact, putArtifact, recordRequestUsage, updateRun } from '../../../src/state/runs'
import { logEvent } from '../../../src/state/diagnostics'
import { validBox, pixelBox } from './boxes'
import { buildReviewBlueprint } from './blueprint'
import { emitCsv } from './csv'
import { isRecord, modelJson, text } from './json'
import { AUDIT_PROMPT, CROP_CHECK_PROMPT, CROP_REPAIR_PROMPT, KEY_PROMPT, PAGE_PROMPT, VISUAL_REPAIR_PROMPT } from './prompts'
import { DEFAULT_GYPSUM_MODELS, type GypsumModels } from './model-steps'
import type { AuditResult, CropCheck, ExtractedFigure, ExtractedQuestion, GypsumCropLink, GypsumQuestion, PageExtraction, PrintedAnswer } from './types'

const JPEG = 'image/jpeg'
const CALL_CONCURRENCY = 4
const BOX_SCHEMA = { type: 'ARRAY', items: { type: 'NUMBER' }, minItems: 4, maxItems: 4 }
const PAGE_SCHEMA = {
  type: 'OBJECT', required: ['declared_labels', 'questions', 'figures', 'issues'], properties: {
    declared_labels: { type: 'ARRAY', items: { type: 'STRING' } },
    questions: { type: 'ARRAY', items: { type: 'OBJECT', required: ['label', 'question', 'options', 'source_pages', 'question_box', 'needs_review'], properties: {
      label: { type: 'STRING' }, question: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } },
      source_pages: { type: 'ARRAY', items: { type: 'INTEGER' } }, question_box: { ...BOX_SCHEMA, nullable: true }, needs_review: { type: 'STRING' },
    } } },
    figures: { type: 'ARRAY', items: { type: 'OBJECT', required: ['linked_labels', 'box_2d', 'kind', 'anchor'], properties: {
      linked_labels: { type: 'ARRAY', items: { type: 'STRING' } }, box_2d: BOX_SCHEMA, kind: { type: 'STRING' }, anchor: { type: 'STRING' },
    } } },
    issues: { type: 'ARRAY', items: { type: 'STRING' } },
  },
}
const KEY_SCHEMA = { type: 'OBJECT', required: ['answers'], properties: { answers: { type: 'ARRAY', items: { type: 'OBJECT', required: ['label', 'answer'], properties: { label: { type: 'STRING' }, answer: { type: 'STRING' } } } } } }
const AUDIT_SCHEMA = { type: 'OBJECT', required: ['pass', 'missing_labels', 'duplicate_labels', 'missing_visual_labels', 'incomplete_option_labels', 'notes'], properties: {
  pass: { type: 'BOOLEAN' }, missing_labels: { type: 'ARRAY', items: { type: 'STRING' } }, duplicate_labels: { type: 'ARRAY', items: { type: 'STRING' } },
  missing_visual_labels: { type: 'ARRAY', items: { type: 'STRING' } }, incomplete_option_labels: { type: 'ARRAY', items: { type: 'STRING' } }, notes: { type: 'ARRAY', items: { type: 'STRING' } },
} }
const VISUAL_SCHEMA = { type: 'OBJECT', required: ['figures'], properties: { figures: { type: 'ARRAY', items: { type: 'OBJECT', required: ['box_2d', 'kind', 'anchor'], properties: { box_2d: BOX_SCHEMA, kind: { type: 'STRING' }, anchor: { type: 'STRING' } } } } } }
const CROP_CHECK_SCHEMA = { type: 'OBJECT', required: ['pass', 'figures', 'issues'], properties: {
  pass: { type: 'BOOLEAN' },
  figures: { type: 'ARRAY', items: { type: 'OBJECT', required: ['linked_labels', 'box_2d', 'kind', 'anchor'], properties: {
    linked_labels: { type: 'ARRAY', items: { type: 'STRING' } }, box_2d: BOX_SCHEMA, kind: { type: 'STRING' }, anchor: { type: 'STRING' },
  } } },
  issues: { type: 'ARRAY', items: { type: 'STRING' } },
} }
const CROP_REPAIR_SCHEMA = { type: 'OBJECT', required: ['figures'], properties: {
  figures: CROP_CHECK_SCHEMA.properties.figures,
} }

export interface GypsumExecutorOptions {
  controller?: GeminiController
  signal?: AbortSignal
  dpi?: number
  reinitEvery?: number
  examPageCount?: number
  answerKeyBytes?: Uint8Array
  answerKeyPageCount?: number
  answerKeyMimeType?: string
  models?: Partial<GypsumModels>
}

type Outcome =
  | { status: 'done'; runId: string; csv: string; flaggedRows: number; notSafeToImport: boolean }
  | { status: 'stopped'; runId: string; reason: string }
  | { status: 'provider-stopped'; runId: string; kind: 'wrong-key' | 'provider-error' }
  | { status: 'aborted'; runId: string }

class ProviderStop extends Error {
  readonly kind: 'wrong-key' | 'provider-error' | 'aborted'
  constructor(kind: 'wrong-key' | 'provider-error' | 'aborted') {
    super(kind)
    this.kind = kind
  }
}

async function concurrentMap<T, R>(values: readonly T[], limit: number, task: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await task(values[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return output
}

async function call(
  controller: GeminiController,
  runId: string,
  prompt: string,
  images: readonly { mimeType: string; base64Data: string }[],
  model: string,
  signal?: AbortSignal,
  maxOutputTokens = 32_768,
  responseSchema?: Record<string, unknown>,
): Promise<string> {
  const result: VisionResult = await controller.runGeminiRequest({
    prompt, images, modelId: model, fallbackModelId: otherEngineModel(model),
    generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: 'application/json', ...(responseSchema === undefined ? {} : { responseSchema }) },
  }, { signal })
  if (!result.ok) {
    await recordRequestUsage(runId)
    throw new ProviderStop(result.kind === 'wrong-key' ? 'wrong-key' : result.kind === 'aborted' ? 'aborted' : 'provider-error')
  }
  await recordRequestUsage(runId, result.usage)
  return result.text
}

async function renderPdf(runId: string, bytes: Uint8Array, offset: number, options: GypsumExecutorOptions) {
  const result = await processPdf(bytes, async (page) => {
    await putArtifact({ runId, kind: 'page-jpeg', pageIndex: offset + page.pageIndex, width: page.width, height: page.height, bytes: await blobToBytes(page.jpeg) })
    if (page.text !== '') await putArtifact({ runId, kind: 'page-text', pageIndex: offset + page.pageIndex, text: page.text })
  }, { dpi: options.dpi ?? 200, reinitEvery: options.reinitEvery ?? 8, signal: options.signal })
  return { pageCount: result.pageCount, complete: result.failures.length === 0 }
}

async function render(runId: string, pdfBytes: Uint8Array, options: GypsumExecutorOptions) {
  const existing = await getArtifacts(runId, 'page-jpeg')
  const expected = (options.examPageCount ?? 0) + (options.answerKeyPageCount ?? 0)
  if (expected > 0 && existing.length >= expected) {
    return { examPages: options.examPageCount ?? existing.length, keyPages: options.answerKeyPageCount ?? 0, complete: true }
  }
  if (existing.length > 0) {
    await clearArtifacts(runId, 'page-jpeg')
    await clearArtifacts(runId, 'page-text')
  }
  const exam = await renderPdf(runId, pdfBytes, 0, options)
  if (!exam.complete || options.answerKeyBytes === undefined) return { examPages: exam.pageCount, keyPages: 0, complete: exam.complete }
  if (isImageMime(options.answerKeyMimeType ?? '')) {
    const bitmap = await decodeImageToBitmap(options.answerKeyBytes, options.answerKeyMimeType ?? '')
    const jpeg = await bitmapToJpeg(bitmap)
    await putArtifact({ runId, kind: 'page-jpeg', pageIndex: exam.pageCount, width: bitmap.width, height: bitmap.height, bytes: await blobToBytes(jpeg) })
    return { examPages: exam.pageCount, keyPages: 1, complete: true }
  }
  const key = await renderPdf(runId, options.answerKeyBytes, exam.pageCount, options)
  return { examPages: exam.pageCount, keyPages: key.pageCount, complete: key.complete }
}

async function image(runId: string, pageIndex: number) {
  const artifact = await getPageArtifact(runId, pageIndex)
  return artifact?.bytes === undefined ? undefined : { mimeType: JPEG, base64Data: bytesToBase64(artifact.bytes) }
}

function label(value: unknown): string {
  return text(value).replace(/^[^0-9]*/, '').replace(/[^0-9].*$/, '')
}

function option(value: string): string {
  return value.trim().replace(/^[A-H][.)\-:]\s*/, '').trim()
}

function pages(value: unknown, maximum: number): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((page): page is number => Number.isInteger(page) && page >= 1 && page <= maximum))]
}

function parseExtraction(value: unknown, corePage: number, maximumPage: number, allowManifestRecovery = false): PageExtraction | undefined {
  if (!isRecord(value) || !Array.isArray(value.declared_labels) || !Array.isArray(value.questions) || !Array.isArray(value.figures)) return undefined
  const declaredLabels = value.declared_labels.map(label).filter(Boolean)
  const questions: ExtractedQuestion[] = []
  for (const item of value.questions) {
    if (!isRecord(item)) continue
    const id = label(item.label)
    const question = text(item.question)
    const options = Array.isArray(item.options) ? item.options.map(text).map(option).filter(Boolean) : []
    if (id === '') continue
    let needsReview = text(item.needs_review)
    if (question === '') needsReview ||= 'empty_question'
    if (options.length < 2) needsReview ||= 'incomplete_options'
    questions.push({
      label: id, question, options, sourcePages: pages(item.source_pages, maximumPage).length > 0 ? pages(item.source_pages, maximumPage) : [corePage],
      questionBox: validBox(item.question_box) ? item.question_box : null,
      needsReview,
    })
  }
  const figures: ExtractedFigure[] = value.figures.flatMap((item) => {
    if (!isRecord(item) || !validBox(item.box_2d) || !Array.isArray(item.linked_labels)) return []
    const linkedLabels = item.linked_labels.map(label).filter(Boolean)
    return linkedLabels.length === 0 ? [] : [{
      page: corePage, linkedLabels, box: item.box_2d,
      kind: text(item.kind) || 'other', anchor: text(item.anchor),
    }]
  })
  const questionLabels = questions.map((row) => row.label)
  const sameManifest = declaredLabels.length === questionLabels.length &&
    declaredLabels.every((id, index) => id === questionLabels[index])
  if (!sameManifest && !allowManifestRecovery) return undefined
  const recovered = [...questions]
  if (!sameManifest) {
    const returned = new Set(questionLabels)
    for (const id of declaredLabels) {
      if (returned.has(id)) continue
      recovered.push({ label: id, question: '', options: [], sourcePages: [corePage], questionBox: null, needsReview: 'manifest_only' })
    }
    recovered.sort((first, second) => declaredLabels.indexOf(first.label) - declaredLabels.indexOf(second.label))
  }
  const issues = Array.isArray(value.issues) ? value.issues.map(text).filter(Boolean) : []
  if (!sameManifest) issues.push('manifest_recovery')
  return { corePage, declaredLabels, questions: recovered, figures, issues }
}

function pagePrompt(corePage: number, examPages: number): string {
  return `${PAGE_PROMPT}\n\nCORE PAGE ABSOLUTE NUMBER: ${corePage}. DOCUMENT PAGES: 1-${examPages}.`
}

async function extractPage(
  controller: GeminiController, runId: string, corePage: number, examPages: number,
  model: string, signal?: AbortSignal,
): Promise<PageExtraction | undefined> {
  const coreIndex = corePage - 1
  const indexes = [coreIndex]
  const images = (await Promise.all(indexes.map((index) => image(runId, index)))).filter((item): item is { mimeType: string; base64Data: string } => item !== undefined)
  let retry = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await call(controller, runId, pagePrompt(corePage, examPages) + retry, images, model, signal, 32_768, PAGE_SCHEMA)
    await putArtifact({ runId, kind: 'index-window', chunkIndex: coreIndex * 3 + attempt, text: raw })
    const parsed = parseExtraction(modelJson(raw), corePage, examPages, attempt === 2)
    if (parsed !== undefined) {
      parsed.questions = parsed.questions.map((question) => ({ ...question, sourcePages: [corePage] }))
      if (parsed.questions.length === 0 && parsed.declaredLabels.length === 0) parsed.issues = []
      const incompleteChoices = parsed.questions.some((question) => question.options.length < 2)
      if (incompleteChoices && attempt < 2) {
        retry = '\n\nRETRY: At least one genuine MCQ has fewer than two choices. Re-read the core page and return every choice. When A-D are labels inside a diagram or graphical panel, return ["A","B","C","D"] and include the whole panel as a figure.'
        continue
      }
    }
    if (parsed !== undefined) return parsed
    retry = '\n\nRETRY: Your previous JSON was invalid or its declared_labels did not exactly match questions. Re-read only the core page and return the complete required shape.'
  }
  return undefined
}

function parseAnswers(value: unknown): PrintedAnswer[] {
  if (!isRecord(value) || !Array.isArray(value.answers)) return []
  const seen = new Set<string>()
  return value.answers.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = label(item.label)
    const answer = text(item.answer).toUpperCase()
    if (id === '' || !/^[A-H]$/.test(answer) || seen.has(id)) return []
    seen.add(id)
    return [{ label: id, index: String(answer.charCodeAt(0) - 65) }]
  })
}

async function readKey(
  controller: GeminiController, runId: string, examPages: number, keyPages: number,
  model: string, signal?: AbortSignal,
): Promise<Map<string, string>> {
  const results = await concurrentMap(Array.from({ length: keyPages }, (_item, index) => index), CALL_CONCURRENCY, async (relative) => {
    const page = await image(runId, examPages + relative)
    if (page === undefined) return []
    const raw = await call(controller, runId, `${KEY_PROMPT}\n\nThis is mark-scheme page ${relative + 1} of ${keyPages}.`, [page], model, signal, 8_192, KEY_SCHEMA)
    await putArtifact({ runId, kind: 'chunk-response', chunkIndex: examPages + relative, text: raw })
    return parseAnswers(modelJson(raw))
  })
  const answers = new Map<string, string>()
  for (const answer of results.flat()) {
    if (!answers.has(answer.label)) answers.set(answer.label, answer.index)
  }
  return answers
}

function yearFrom(texts: readonly string[]): string {
  for (const content of texts) {
    const match = /\b(?:19|20)\d{2}\b/.exec(content)
    if (match !== null) return match[0]
  }
  return ''
}

async function cropFigures(runId: string, figures: readonly ExtractedFigure[], rows: GypsumQuestion[], padding = 24) {
  const byLabel = new Map(rows.map((row) => [row.id, row]))
  const failures: string[] = []
  const crops: GypsumCropLink[] = []
  const existingPaths = new Set((await getArtifacts(runId, 'crop')).flatMap((crop) => crop.path === undefined ? [] : [crop.path]))
  let pathNumber = 1
  const nextPath = () => {
    while (existingPaths.has(`images/gypsum-${String(pathNumber).padStart(3, '0')}.jpg`)) pathNumber += 1
    const path = `images/gypsum-${String(pathNumber).padStart(3, '0')}.jpg`
    existingPaths.add(path)
    pathNumber += 1
    return path
  }
  for (const figure of figures) {
    const source = await getPageArtifact(runId, figure.page - 1)
    if (source?.bytes === undefined || source.width === undefined || source.height === undefined) {
      failures.push(`page ${figure.page} unavailable for ${figure.anchor}`); continue
    }
    const linked = figure.linkedLabels.filter((id) => byLabel.has(id))
    if (linked.length === 0) continue
    const path = nextPath()
    try {
      const cropped = await cropJpeg(new Blob([source.bytes as BlobPart], { type: JPEG }), pixelBox(figure.box, source.width, source.height, padding))
      await putArtifact({ runId, kind: 'crop', pageIndex: figure.page - 1, path, bytes: await blobToBytes(cropped) })
      for (const id of linked) (byLabel.get(id) as GypsumQuestion).image_urls.push(path)
      crops.push({ ...figure, linkedLabels: linked, path })
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { failures, crops }
}

const COUNT_WORDS: Readonly<Record<string, number>> = {
  ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
}

function expectedCount(pageText: readonly string[]): number | undefined {
  const match = /there\s+are\s+(\d+|[a-z]+)\s+questions\b/i.exec(pageText.join('\n'))
  if (match === null) return undefined
  return /^\d+$/.test(match[1]) ? Number(match[1]) : COUNT_WORDS[match[1].toLowerCase()]
}

function deterministicIssues(rows: readonly GypsumQuestion[], expected: number | undefined) {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([id]) => id)
  const upper = expected ?? Math.max(0, ...rows.map((row) => Number(row.id)).filter(Number.isFinite))
  const missing = Array.from({ length: upper }, (_item, index) => String(index + 1)).filter((id) => !counts.has(id))
  return { missing, duplicate }
}

export function dedupeCoreQuestions(pages: readonly PageExtraction[]): { questions: ExtractedQuestion[]; issues: string[] } {
  const chosen = new Map<string, { question: ExtractedQuestion; corePage: number; score: number }>()
  const order: string[] = []
  const issues: string[] = []
  for (const page of pages) {
    for (const question of page.questions) {
      const score = (question.sourcePages.includes(page.corePage) ? 1_000_000 : 0) +
        question.options.length * 10_000 + question.question.length
      const current = chosen.get(question.label)
      if (current === undefined) {
        chosen.set(question.label, { question, corePage: page.corePage, score })
        order.push(question.label)
        continue
      }
      if (score > current.score) chosen.set(question.label, { question, corePage: page.corePage, score })
      if (score === current.score && page.corePage !== current.corePage) {
        issues.push(`ambiguous_duplicate_${question.label}:pages_${current.corePage}_${page.corePage}`)
      }
    }
  }
  return { questions: order.map((id) => (chosen.get(id) as { question: ExtractedQuestion }).question), issues }
}

function parseAudit(value: unknown): AuditResult | undefined {
  if (!isRecord(value) || typeof value.pass !== 'boolean') return undefined
  const list = (item: unknown) => Array.isArray(item) ? item.map(text).filter(Boolean) : []
  return {
    pass: value.pass, missingLabels: list(value.missing_labels), duplicateLabels: list(value.duplicate_labels),
    missingVisualLabels: list(value.missing_visual_labels), incompleteOptionLabels: list(value.incomplete_option_labels), notes: list(value.notes),
  }
}

async function audit(
  controller: GeminiController, runId: string, examPages: number, rows: readonly GypsumQuestion[],
  figures: readonly ExtractedFigure[], model: string, signal?: AbortSignal,
): Promise<AuditResult[]> {
  const windows = Array.from({ length: Math.ceil(examPages / 4) }, (_item, index) => index * 4)
  return concurrentMap(windows, CALL_CONCURRENCY, async (start) => {
    const indexes = Array.from({ length: Math.min(4, examPages - start) }, (_item, offset) => start + offset)
    const images = (await Promise.all(indexes.map((index) => image(runId, index)))).filter((item): item is { mimeType: string; base64Data: string } => item !== undefined)
    const relevant = rows.filter((row) => row.source_page !== undefined && indexes.includes(row.source_page - 1))
    const inventory = figures.filter((figure) => indexes.includes(figure.page - 1)).map((figure) => ({ page: figure.page, labels: figure.linkedLabels, kind: figure.kind, anchor: figure.anchor }))
    const raw = await call(controller, runId, `${AUDIT_PROMPT}\n\nROWS:\n${JSON.stringify(relevant)}\n\nFIGURE INVENTORY:\n${JSON.stringify(inventory)}`, images, model, signal, 32_768, AUDIT_SCHEMA)
    return parseAudit(modelJson(raw)) ?? { pass: false, missingLabels: [], duplicateLabels: [], missingVisualLabels: [], incompleteOptionLabels: [], notes: ['audit_unparseable'] }
  })
}

async function repairMissingVisuals(
  controller: GeminiController, runId: string, rows: readonly GypsumQuestion[], labels: readonly string[],
  model: string, signal?: AbortSignal,
): Promise<ExtractedFigure[]> {
  const byLabel = new Map(rows.map((row) => [row.id, row]))
  const unique = [...new Set(labels)]
  const repaired = await concurrentMap(unique, CALL_CONCURRENCY, async (id) => {
    const row = byLabel.get(id)
    if (row?.source_page === undefined) return []
    const page = await image(runId, row.source_page - 1)
    if (page === undefined) return []
    const raw = await call(
      controller, runId,
      `${VISUAL_REPAIR_PROMPT}\n\nQUESTION LABEL: ${id}\nEXTRACTED ROW:\n${JSON.stringify(row)}`,
      [page], model, signal, 8_192, VISUAL_SCHEMA,
    )
    const parsed = modelJson(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.figures)) return []
    return parsed.figures.flatMap((item): ExtractedFigure[] => {
      if (!isRecord(item) || !validBox(item.box_2d)) return []
      return [{ page: row.source_page as number, linkedLabels: [id], box: item.box_2d, kind: text(item.kind) || 'other', anchor: text(item.anchor) }]
    })
  })
  return repaired.flat()
}

export function parseCropCheck(value: unknown, page: number, allowedLabels: ReadonlySet<string>): CropCheck | undefined {
  if (!isRecord(value) || typeof value.pass !== 'boolean' || !Array.isArray(value.figures)) return undefined
  const figures = value.figures.flatMap((item): ExtractedFigure[] => {
    if (!isRecord(item) || !validBox(item.box_2d) || !Array.isArray(item.linked_labels)) return []
    const linkedLabels = [...new Set(item.linked_labels.map(label).filter((id) => id !== '' && allowedLabels.has(id)))]
    if (linkedLabels.length === 0) return []
    return [{ page, linkedLabels, box: item.box_2d, kind: text(item.kind) || 'other', anchor: text(item.anchor) }]
  })
  const issues = Array.isArray(value.issues) ? value.issues.map(text).filter(Boolean) : []
  return { pass: value.pass && figures.length > 0, figures, issues }
}

export function repairPreservesFigureCounts(
  required: readonly ExtractedFigure[],
  proposed: readonly ExtractedFigure[],
  labels: ReadonlySet<string>,
): boolean {
  for (const id of labels) {
    const requiredCount = required.filter((figure) => figure.linkedLabels.includes(id)).length
    const proposedCount = proposed.filter((figure) => figure.linkedLabels.includes(id)).length
    if (proposedCount < requiredCount) return false
  }
  return true
}

async function verifyCropPages(
  controller: GeminiController,
  runId: string,
  rows: readonly GypsumQuestion[],
  crops: readonly GypsumCropLink[],
  model: string,
  signal?: AbortSignal,
  onlyPages?: ReadonlySet<number>,
  round = 0,
): Promise<Array<{ page: number; check: CropCheck }>> {
  const pages = [...new Set(crops.map((crop) => crop.page))]
    .filter((page) => onlyPages === undefined || onlyPages.has(page))
    .sort((first, second) => first - second)
  return concurrentMap(pages, CALL_CONCURRENCY, async (page) => {
    const source = await image(runId, page - 1)
    const pageRows = rows.filter((row) => row.source_page === page)
    const allowedLabels = new Set(pageRows.map((row) => row.id))
    const pageCrops = crops.filter((crop) => crop.page === page)
    if (source === undefined) {
      return { page, check: { pass: false, figures: [], issues: ['source_page_unavailable'] } }
    }
    const attached: Array<{ image: { mimeType: string; base64Data: string }; path: string; labels: string[] }> = []
    for (const crop of pageCrops) {
      const artifact = await getCropByPath(runId, crop.path)
      if (artifact?.bytes === undefined) continue
      attached.push({ image: { mimeType: JPEG, base64Data: bytesToBase64(artifact.bytes) }, path: crop.path, labels: crop.linkedLabels })
    }
    const mapping = attached.map((crop, index) => ({ image: index + 2, path: crop.path, linked_labels: crop.labels }))
    const raw = await call(
      controller,
      runId,
      `${CROP_CHECK_PROMPT}\n\nSOURCE PAGE: ${page}\nCURRENT CROP IMAGE MAP:\n${JSON.stringify(mapping)}\n\nQUESTION ROWS ON THIS PAGE:\n${JSON.stringify(pageRows)}`,
      [source, ...attached.map((crop) => crop.image)],
      model,
      signal,
      16_384,
      CROP_CHECK_SCHEMA,
    )
    await putArtifact({ runId, kind: 'figure-window', chunkIndex: round * 10_000 + page - 1, text: raw })
    return {
      page,
      check: parseCropCheck(modelJson(raw), page, allowedLabels) ?? {
        pass: false, figures: [], issues: ['crop_check_unparseable'],
      },
    }
  })
}

async function proposeCropRepairs(
  controller: GeminiController,
  runId: string,
  rows: readonly GypsumQuestion[],
  crops: readonly GypsumCropLink[],
  failedChecks: readonly { page: number; check: CropCheck }[],
  model: string,
  signal?: AbortSignal,
): Promise<Array<{ page: number; check: CropCheck }>> {
  const failed = failedChecks.filter(({ check }) => !check.pass)
  return concurrentMap(failed, CALL_CONCURRENCY, async ({ page, check }) => {
    const source = await image(runId, page - 1)
    const pageRows = rows.filter((row) => row.source_page === page)
    const allowedLabels = new Set(pageRows.map((row) => row.id))
    if (source === undefined) {
      return { page, check: { pass: false, figures: [], issues: ['source_page_unavailable_for_crop_repair'] } }
    }
    const inventory = crops.filter((crop) => crop.page === page).map((crop) => ({
      path: crop.path, linked_labels: crop.linkedLabels, box_2d: crop.box, kind: crop.kind, anchor: crop.anchor,
    }))
    const raw = await call(
      controller,
      runId,
      `${CROP_REPAIR_PROMPT}\n\nSOURCE PAGE: ${page}\nDEFECT REPORT:\n${JSON.stringify(check.issues)}\n\nINSPECTOR REQUIRED INVENTORY:\n${JSON.stringify(check.figures)}\n\nCURRENT INVENTORY:\n${JSON.stringify(inventory)}\n\nQUESTION ROWS:\n${JSON.stringify(pageRows)}`,
      [source],
      model,
      signal,
      16_384,
      CROP_REPAIR_SCHEMA,
    )
    await putArtifact({ runId, kind: 'figure-window', chunkIndex: 5_000 + page - 1, text: raw })
    const parsed = modelJson(raw)
    const normalized = isRecord(parsed)
      ? parseCropCheck({ pass: false, figures: parsed.figures, issues: check.issues }, page, allowedLabels)
      : undefined
    if (normalized !== undefined) {
      const currentFigures = crops.filter((crop) => crop.page === page)
      if (
        !repairPreservesFigureCounts(check.figures, normalized.figures, allowedLabels) ||
        !repairPreservesFigureCounts(currentFigures, normalized.figures, allowedLabels)
      ) {
        normalized.figures = []
        normalized.issues.push('crop_repair_reduced_required_image_count')
      }
    }
    return {
      page,
      check: normalized ?? { pass: false, figures: [], issues: [...check.issues, 'crop_repair_unparseable'] },
    }
  })
}

async function replaceFailedPageCrops(
  runId: string,
  rows: GypsumQuestion[],
  crops: readonly GypsumCropLink[],
  checks: readonly { page: number; check: CropCheck }[],
) {
  const failed = checks.filter(({ check }) => !check.pass && check.figures.length > 0)
  const failedPages = new Set(failed.map(({ page }) => page))
  const replacementFigures = failed.flatMap(({ check }) => check.figures)
  const removed = crops.filter((crop) => failedPages.has(crop.page))
  const removedPaths = new Set(removed.map((crop) => crop.path))
  await clearCropArtifacts(runId, removedPaths)
  for (const row of rows) row.image_urls = row.image_urls.filter((path) => !removedPaths.has(path))
  const replacement = await cropFigures(runId, replacementFigures, rows, 8)
  return {
    failedPages,
    crops: [...crops.filter((crop) => !failedPages.has(crop.page)), ...replacement.crops],
    figures: replacementFigures,
    failures: replacement.failures,
    checkIssues: failed.flatMap(({ page, check }) => check.issues.map((issue) => `page_${page}:${issue}`)),
  }
}

export async function executeRun(runId: string, pdfBytes: Uint8Array, options: GypsumExecutorOptions = {}): Promise<Outcome> {
  const controller = options.controller ?? geminiController
  const models = { ...DEFAULT_GYPSUM_MODELS, ...options.models }
  try {
    await updateRun(runId, { status: 'running', step: 'render', stepStartedAt: Date.now() })
    const rendered = await render(runId, pdfBytes, options)
    if (!rendered.complete || rendered.examPages === 0) {
      await updateRun(runId, { status: 'stopped', stopReason: 'gypsum_render_failed' })
      return { status: 'stopped', runId, reason: 'gypsum_render_failed' }
    }

    await updateRun(runId, { step: 'planner', stepStartedAt: Date.now(), plannerWindowCount: rendered.examPages, plannerWindowsDone: 0 })
    let completed = 0
    const extracted = await concurrentMap(
      Array.from({ length: rendered.examPages }, (_item, index) => index + 1),
      CALL_CONCURRENCY,
      async (page) => {
        const result = await extractPage(controller, runId, page, rendered.examPages, models.extract, options.signal)
        completed += 1
        await updateRun(runId, { plannerWindowsDone: completed })
        return result
      },
    )
    const unreadablePages = extracted.flatMap((result, index) => result === undefined ? [index + 1] : [])
    if (unreadablePages.length > 0) {
      const reason = `gypsum_page_extraction_invalid:${unreadablePages.join(',')}`
      await updateRun(runId, { status: 'stopped', stopReason: reason })
      return { status: 'stopped', runId, reason }
    }
    const pages = extracted as PageExtraction[]
    const extractionIssues = pages.flatMap((page) => page.issues.map((issue) => `page_${page.corePage}:${issue}`))
    const deduped = dedupeCoreQuestions(pages)
    extractionIssues.push(...deduped.issues)
    const extractedRows = deduped.questions
    let figures = pages.flatMap((page) => page.figures)
    const textArtifacts = await getArtifacts(runId, 'page-text')
    const examText = textArtifacts.filter((artifact) => (artifact.pageIndex ?? rendered.examPages) < rendered.examPages).map((artifact) => artifact.text ?? '')
    const visibleYear = yearFrom(examText)
    const answers = rendered.keyPages > 0
      ? await readKey(controller, runId, rendered.examPages, rendered.keyPages, models.key, options.signal)
      : new Map<string, string>()

    const rows: GypsumQuestion[] = extractedRows.map((row) => {
      const answer = answers.get(row.label) ?? ''
      const validAnswer = /^\d+$/.test(answer) && Number(answer) < row.options.length ? answer : ''
      return {
        id: row.label, topic: '', subtopic: '', year: visibleYear,
        question: row.question, options: [...row.options], correct_index: validAnswer,
        image_urls: [], needs_review: row.needsReview || (validAnswer === '' ? (rendered.keyPages > 0 ? 'key_missing' : 'no_answer_key') : ''),
        ...(row.sourcePages[0] === undefined ? {} : { source_page: row.sourcePages[0] }),
        ...(row.questionBox === null ? {} : { source_box: row.questionBox }),
      }
    })

    await updateRun(runId, { step: 'crops', stepStartedAt: Date.now() })
    const firstCropPass = await cropFigures(runId, figures, rows)
    const cropFailures = [...firstCropPass.failures]
    let cropLinks = [...firstCropPass.crops]

    await updateRun(runId, { step: 'audit', stepStartedAt: Date.now() })
    let audits = await audit(controller, runId, rendered.examPages, rows, figures, models.audit, options.signal)
    const missingVisuals = audits.flatMap((result) => result.missingVisualLabels)
    if (missingVisuals.length > 0) {
      const repairedFigures = await repairMissingVisuals(controller, runId, rows, missingVisuals, models.extract, options.signal)
      if (repairedFigures.length > 0) {
        const repairCropPass = await cropFigures(runId, repairedFigures, rows)
        cropFailures.push(...repairCropPass.failures)
        cropLinks.push(...repairCropPass.crops)
        figures.push(...repairedFigures)
        audits = await audit(controller, runId, rendered.examPages, rows, figures, models.audit, options.signal)
      }
    }

    await updateRun(runId, { step: 'crops', stepStartedAt: Date.now() })
    const firstCropChecks = await verifyCropPages(controller, runId, rows, cropLinks, models.crop_check, options.signal)
    const failedFirstChecks = firstCropChecks.filter(({ check }) => !check.pass)
    const cropRepairs = await proposeCropRepairs(
      controller, runId, rows, cropLinks, failedFirstChecks, models.crop_check, options.signal,
    )
    const cropQualityFailures: string[] = cropRepairs
      .filter(({ check }) => check.figures.length === 0)
      .flatMap(({ page, check }) => [
        `crop_check_page_${page}:no_valid_replacement_inventory`,
        ...check.issues.map((issue) => `crop_check_page_${page}:${issue}`),
      ])
    if (cropRepairs.some(({ check }) => check.figures.length > 0)) {
      const replacement = await replaceFailedPageCrops(runId, rows, cropLinks, cropRepairs)
      cropFailures.push(...replacement.failures)
      cropLinks = replacement.crops
      figures = [
        ...figures.filter((figure) => !replacement.failedPages.has(figure.page)),
        ...replacement.figures,
      ]
      const secondCropChecks = await verifyCropPages(
        controller, runId, rows, cropLinks, models.crop_check, options.signal,
        replacement.failedPages, 1,
      )
      cropQualityFailures.push(...secondCropChecks
        .filter(({ check }) => !check.pass)
        .flatMap(({ page, check }) => [
          `crop_check_page_${page}:failed_after_repair`,
          ...check.issues.map((issue) => `crop_check_page_${page}:${issue}`),
        ]))
    }
    const deterministic = deterministicIssues(rows, expectedCount(examText))
    const modelFailures = audits.filter((result) => !result.pass)
    const notSafeToImport = extractionIssues.length > 0 || cropFailures.length > 0 || cropQualityFailures.length > 0 || deterministic.missing.length > 0 || deterministic.duplicate.length > 0 || modelFailures.length > 0
    await putArtifact({ runId, kind: 'audit-report', json: {
      audit_pass: !notSafeToImport, risk_class: notSafeToImport ? 'not_safe_to_import' : 'safe_to_import',
      failed_rows: audits.flatMap((result) => [...result.missingVisualLabels, ...result.incompleteOptionLabels]),
      global_failures: [...extractionIssues, ...cropFailures, ...cropQualityFailures, ...deterministic.missing.map((id) => `missing_question:${id}`), ...deterministic.duplicate.map((id) => `duplicate_question:${id}`)],
      answer_policy_violations: [], crop_failures: cropFailures, notes: audits.flatMap((result) => result.notes),
    } })

    await updateRun(runId, { step: 'emit', stepStartedAt: Date.now() })
    const csv = emitCsv(rows)
    await putArtifact({ runId, kind: 'blueprint-valid', json: buildReviewBlueprint(rendered.examPages, rows, cropLinks, rendered.keyPages > 0) })
    await putArtifact({ runId, kind: 'merged-rows', json: rows })
    await putArtifact({ runId, kind: 'csv', text: csv })
    const flaggedRows = rows.filter((row) => row.needs_review !== '').length
    await updateRun(runId, { status: 'done', flaggedRows, notSafeToImport, auditUnavailable: false })
    await logEvent({ scope: 'engine', level: notSafeToImport ? 'warn' : 'info', event: 'gypsum.done', runId, detail: { rows: rows.length, figures: figures.length, flaggedRows, cropFailures: cropFailures.length, cropQualityFailures: cropQualityFailures.length, auditFailures: modelFailures.length } })
    return { status: 'done', runId, csv, flaggedRows, notSafeToImport }
  } catch (error) {
    if (error instanceof ProviderStop) {
      if (error.kind === 'aborted') {
        await updateRun(runId, { status: 'paused' })
        return { status: 'aborted', runId }
      }
      await updateRun(runId, { status: 'stopped', stopReason: error.kind })
      return { status: 'provider-stopped', runId, kind: error.kind }
    }
    await updateRun(runId, { status: 'stopped', stopReason: 'gypsum_unexpected_error' })
    throw error
  }
}
