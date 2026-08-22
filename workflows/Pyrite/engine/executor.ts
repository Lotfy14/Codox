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
  section: string
  sourcePages: number[]
  question: string
  options: string[]
  correctIndex: string
  needsReview: string
  continuation: boolean
  sourceBox: Box2d | null
}

type KeyAnswer = { section: string; label: string; correctIndex: string; needsReview: string }

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

/**
 * The printed number without the punctuation that trails it.
 *
 * One window reads "15" off a page and the next reads "15)" off the same page.
 * Nothing in the paper changed, so the two must key alike; before this, one
 * question became two rows and a key entry matched neither.
 */
function normalizeLabel(value: unknown): string {
  return text(value).replace(/^[([]+/, '').replace(/[).:-]+$/, '').trim()
}

/**
 * Collapses a printed heading to a comparable token: "Section B" and "B" are
 * the same section, and a paper without headings yields ''.
 */
function normalizeSection(value: unknown): string {
  return text(value).toLowerCase().replace(/^section\s+/, '').replace(/[^a-z0-9]/g, '')
}

/**
 * A printed key letter, and only a letter. A digit is refused rather than
 * guessed at: a key that writes "3" beside a question may mean the third
 * choice or the fourth, and nothing on the page says which base it counted
 * from. A refused entry blanks the answer instead of shipping a coin flip.
 */
function letterIndex(value: string): string {
  const letter = value.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (letter.length !== 1) return ''
  return String(letter.charCodeAt(0) - 97)
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
    const label = normalizeLabel(raw.label)
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
      section: normalizeSection(raw.section),
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
    const label = normalizeLabel(raw.label)
    const correctIndex = text(raw.correct_index)
    return label === '' ? [] : [{ section: normalizeSection(raw.section), label, correctIndex, needsReview: text(raw.needs_review) }]
  })
}

/**
 * Answers a key page prints, read out of an ordinary extraction response.
 *
 * Some papers bind their answer key into the exam PDF itself, so the page is
 * already rendered and already inside a window this run pays for. Reading its
 * mappings costs no additional request; leaving them unread stranded 41 of 45
 * answers on a page the model had in front of it.
 */
function parseKeyAnswers(value: unknown): KeyAnswer[] {
  if (!isRecord(value) || !Array.isArray(value.key_answers)) return []
  return value.key_answers.flatMap((raw) => {
    if (!isRecord(raw)) return []
    const label = normalizeLabel(raw.label)
    if (label === '') return []
    const correctIndex = letterIndex(text(raw.answer))
    return [{
      section: normalizeSection(raw.section),
      label,
      correctIndex,
      needsReview: correctIndex === '' ? 'key_unclear' : '',
    }]
  })
}

function requestPrompt(mode: 'exam' | 'key', firstPage: number, lastPage: number, coreLastPage = lastPage): string {
  if (mode === 'key') return [
    'Read this answer-key page window. Return JSON only: {"answers":[{"section":"printed section heading or empty","label":"printed question number","correct_index":"zero-based option index or empty","needs_review":""}]}.',
    'When the key groups answers under headings such as "Section A", return that heading in section for every entry beneath it. Papers restart numbering at each section, so the heading is what tells question 3 of one section from question 3 of another.',
    'Do not infer an answer. Return an empty correct_index and a reason when a mark is unclear. Do not return question text.',
    `The images are answer-key pages ${firstPage} through ${lastPage}.`,
  ].join('\n')
  return [
    'Read these exam pages and return JSON only: {"rows":[{"label":"printed question number or empty","section":"printed section heading or empty","source_pages":[1],"question":"verbatim question text","options":["choice text"],"correct_index":"zero-based visible answer or empty","needs_review":"","continuation":false,"box_2d":[ymin,xmin,ymax,xmax]}],"key_answers":[{"section":"","label":"","answer":""}]}.',
    `Extract every question that starts on core pages ${firstPage} through ${coreLastPage}; page ${coreLastPage + 1} may be included only as a look-ahead for options that continue from a core page. Keep question text and choices verbatim. Never infer an answer from subject knowledge.`,
    'For EACH question, inspect every option row for answer evidence: especially a coloured highlighter stroke (including yellow), a tick, circle, underline, strike-through, or a letter written beside the option/question. A single clear highlight on an option IS visible answer evidence: return that option\'s zero-based correct_index. Do not copy the highlight into option text. If marks identify multiple options, are too faint, or are absent, leave correct_index empty and give a concise needs_review reason.',
    'Some papers place one large handwritten answer letter beside each question in an outer page margin rather than on an option. Read that ordered margin column from top to bottom and map each letter to the question aligned with it; it is visible answer evidence, not a subject-knowledge answer.',
    'For every normal question return box_2d as a tight normalized [ymin,xmin,ymax,xmax] box in 0–1000 page coordinates. Include its printed number, full stem, every option, and the nearby answer mark; use the image edges only when the question truly touches them. This box is for Review display only and does not change extraction.',
    'When the paper prints section headings such as "Section A", return that heading in section for every question beneath it, and keep the printed number in label exactly as it appears. Numbering restarts at each section, so the heading is the only thing separating question 3 of one section from question 3 of another.',
    'If a page in this window is an answer key rather than exam questions — a printed or handwritten list pairing question numbers with choice letters — do not emit questions from it. Return every pair it prints in key_answers, giving the section heading written above each group and the letter exactly as written. Read letters off the page only; never supply one from subject knowledge. Return an empty key_answers array when no page is a key.',
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

/**
 * Carries a section heading forward onto the pages printed beneath it.
 *
 * A heading appears once, so only the window that renders that page can report
 * it; every later window covering the same section answers with an empty
 * section. Inheriting from the nearest earlier page that declared one rebuilds
 * the boundary the paper actually prints, which is what lets a sectioned key
 * attach without guessing. It only ever fills a blank — a row that read its
 * own heading keeps it, so a genuine mid-document boundary still wins.
 */
export function fillSections(windows: readonly (readonly ParsedRow[])[]): ParsedRow[][] {
  const declared = new Map<number, string>()
  for (const rows of windows) {
    for (const row of rows) {
      const page = row.sourcePages[0]
      if (row.section === '' || page === undefined || declared.has(page)) continue
      declared.set(page, row.section)
    }
  }
  const pages = [...declared.keys()].sort((first, second) => first - second)
  const inherited = (page: number): string => {
    let value = ''
    for (const candidate of pages) {
      if (candidate > page) break
      value = declared.get(candidate) ?? value
    }
    return value
  }
  return windows.map((rows) => rows.map((row) => {
    const page = row.sourcePages[0]
    if (row.section !== '' || page === undefined) return row
    return { ...row, section: inherited(page) }
  }))
}

function modalOptionCount(rows: readonly ParsedRow[]): number | undefined {
  const counts = new Map<number, number>()
  for (const row of rows) {
    if (row.continuation || row.options.length < 2) continue
    counts.set(row.options.length, (counts.get(row.options.length) ?? 0) + 1)
  }
  let modal: number | undefined
  let best = 0
  for (const [count, seen] of counts) if (seen > best) [best, modal] = [seen, count]
  return modal
}

/** Whether `tail` already ends `options`, so appending it would double it. */
function alreadyEnds(options: readonly string[], tail: readonly string[]): boolean {
  if (tail.length === 0 || tail.length > options.length) return false
  const offset = options.length - tail.length
  return tail.every((option, index) => normalizedContent(option) === normalizedContent(options[offset + index] ?? ''))
}

/**
 * Joins an option list printed at the top of a page to the stem it continues.
 *
 * Two rules keep it from welding choices onto an unrelated question, which is
 * what it did on a real paper:
 *
 * 1. The choices are printed on the LAST page the row names. The model reports
 *    the stem's page beside it — `[2,3]` for choices printed on page 3 — so
 *    reading sourcePages[0] searched one page too early and hung a page-3
 *    option list on a page-1 question.
 * 2. Only a stem actually missing choices may receive them: one that declared
 *    it runs onto this page, one flagged cut, or one that came back shorter
 *    than the paper's usual choice count. Taking the nearest row instead built
 *    8-option hybrids out of two complete questions while the real owner
 *    stayed truncated anyway.
 *
 * Callers pass ONE request's rows. The prompt's "emit one row before normal
 * questions" contract is per response, and reaching across responses let a
 * page-7 option list attach to a question two windows back.
 */
export function stitchContinuations(
  rows: readonly ParsedRow[],
  modal = modalOptionCount(rows),
): ParsedRow[] {
  const output = rows.map((row) => ({ ...row }))
  const absorbed = new Set<number>()
  for (const [index, row] of output.entries()) {
    if (!row.continuation) continue
    const page = row.sourcePages.at(-1)
    if (page === undefined) {
      output[index] = { ...row, needsReview: row.needsReview || 'orphaned_page_continuation' }
      continue
    }
    const owns = (candidate: ParsedRow): boolean =>
      !candidate.continuation &&
      candidate.sourcePages.includes(page - 1) &&
      (candidate.sourcePages.includes(page) ||
        candidate.needsReview.includes('cut') ||
        (modal !== undefined && candidate.options.length < modal))
    // The prompt puts the continuation BEFORE the page's own questions, so its
    // stem is usually earlier in the response but can also be later — a stem
    // that declared it runs onto this page is emitted in its own page order.
    const before = output.slice(0, index).findLastIndex(owns)
    const after = output.findIndex((candidate, at) => at > index && owns(candidate))
    const priorIndex = before === -1 ? after : before
    const prior = priorIndex === -1 ? undefined : output[priorIndex]
    if (prior === undefined || priorIndex === -1) {
      // A flagged fragment the tutor can see beats choices silently welded to
      // whichever question happened to sit nearby.
      output[index] = { ...row, needsReview: row.needsReview || 'orphaned_page_continuation' }
      continue
    }
    absorbed.add(index)
    if (alreadyEnds(prior.options, row.options)) {
      // The stem already read across the break itself, so this row is the same
      // choices a second time rather than more of them.
      output[priorIndex] = { ...prior, sourcePages: [...new Set([...prior.sourcePages, ...row.sourcePages])] }
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
  return output.filter((_, index) => !absorbed.has(index))
}

function normalizedContent(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

type Candidate = { label: string; section: string; contentKey: string; page: number | undefined }
type Slot = Candidate & { row: ExamQuestion; score: number; index: number }

/** Cores are two pages wide with a one-page look-ahead. */
const PAGE_OVERLAP = 1

/**
 * Whether two observations are one question, or two questions that merely
 * share a printed number.
 *
 * A printed label is unique only inside its own section. A paper that restarts
 * at "1" for Section B gave 20 of its 45 questions a label Section A had
 * already used, and a document-wide label key discarded every one of them —
 * silently, the survivor picked by a text-length score. The section heading
 * settles it whenever the model read one. Failing that the page distance does:
 * a window overlap re-reads a question at most one page from where the
 * neighbouring window put it, while a section restart is many pages away.
 */
function sameQuestion(slot: Slot, candidate: Candidate): boolean {
  if (slot.section !== '' && candidate.section !== '' && slot.section !== candidate.section) return false
  const labelMatch = candidate.label !== '' && slot.label === candidate.label
  // Exact content still recognizes a re-read whose label was dropped or
  // misread, while leaving genuinely distinct questions apart.
  if (!labelMatch && slot.contentKey !== candidate.contentKey) return false
  if (slot.page === undefined || candidate.page === undefined) return true
  return Math.abs(slot.page - candidate.page) <= PAGE_OVERLAP
}

function examQuestion(row: ParsedRow): ExamQuestion {
  return {
    id: '',
    topic: '', subtopic: '', year: '', question: row.question, options: row.options,
    correct_index: row.correctIndex, image_urls: [], needs_review: row.needsReview,
    ...(row.sourcePages[0] === undefined ? {} : { source_page: row.sourcePages[0] }),
    ...(row.sourceBox === null ? {} : { source_box: row.sourceBox }),
  }
}

export function dedupe(rows: readonly ParsedRow[]): ExamQuestion[] {
  const slots: Slot[] = []
  for (const [index, row] of rows.entries()) {
    const candidate: Candidate = {
      label: row.label,
      section: row.section,
      contentKey: `${normalizedContent(row.question)} ${row.options.map(normalizedContent).join(' ')}`,
      page: row.sourcePages[0],
    }
    const score = row.question.length + row.options.join('').length + (row.correctIndex === '' ? 0 : 1_000_000)
    const slot = slots.find((existing) => sameQuestion(existing, candidate))
    if (slot === undefined) {
      slots.push({ ...candidate, row: examQuestion(row), score, index })
      continue
    }
    // A look-ahead re-read can carry the label or heading the first sighting
    // missed. Adopting them keeps the slot recognizable to later windows
    // without letting the weaker reading replace the row itself.
    if (slot.label === '') slot.label = candidate.label
    if (slot.section === '') slot.section = candidate.section
    if (score > slot.score) {
      slot.row = examQuestion(row)
      slot.score = score
    }
  }
  // Keep the document's visible label as the id: shared benchmark truth is
  // keyed by it. Ids are unique per import, so a label a later section reuses
  // takes a suffix rather than overwriting the first section's question.
  const taken = new Set<string>()
  return slots.map((slot) => {
    const preferred = slot.label === '' ? `pyrite-${slot.index + 1}` : slot.label
    let id = preferred
    for (let n = 2; taken.has(id); n++) id = `${preferred}#${n}`
    taken.add(id)
    return { ...slot.row, id }
  })
}

function answerSlot(section: string, label: string): string {
  return `${section} ${label}`
}

/**
 * Attaches a key answer to the row it names.
 *
 * The section matters here for the reason it matters in dedupe: a key listing
 * "Section A 3: B" and "Section B 3: A" holds two answers for the label "3",
 * and choosing between them by guess ships a wrong answer. An unresolved label
 * is flagged, never assigned.
 */
function attachAnswer(row: ParsedRow, answers: ReadonlyMap<string, KeyAnswer>): ParsedRow {
  if (answers.size === 0 || row.correctIndex !== '' || row.label === '') return row
  let answer = answers.get(answerSlot(row.section, row.label))
  if (answer === undefined) {
    const matches = [...answers.values()].filter((entry) => entry.label === row.label)
    if (matches.length !== 1) return matches.length === 0 ? row : { ...row, needsReview: 'key_ambiguous_label' }
    answer = matches[0] as KeyAnswer
  }
  if (!validIndex(answer.correctIndex, row.options.length)) {
    return { ...row, needsReview: answer.needsReview || 'key_unclear' }
  }
  return { ...row, correctIndex: answer.correctIndex, needsReview: answer.needsReview }
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
    const extracted: ParsedRow[][] = []
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
        let keyAnswers = mode === 'exam' ? parseKeyAnswers(parsed) : []
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
          keyAnswers = mode === 'exam' ? parseKeyAnswers(parsed) : []
          if (rows === undefined) {
            await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response: response.text, invalid: true } })
            return { start, coreLast, rows: undefined, keyAnswers, requests }
          }
        }
        await putArtifact({ runId, kind: 'index-window', chunkIndex: offset + start, json: { workflow: 'pyrite', mode, response: response.text } })
        return { start, coreLast, rows, keyAnswers, requests }
        },
      )
      for (const result of pageResults) {
        requestCount += result.requests
        if (result.rows === undefined) {
          await updateRun(runId, { status: 'stopped', stopReason: 'extract_invalid' })
          return { status: 'stopped', runId, reason: 'extract_invalid' }
        }
        // An answer key bound into the exam PDF is read by the window that
        // already renders it, so its mappings arrive on the extraction response
        // and cost no request of their own.
        for (const answer of result.keyAnswers) answers.set(answerSlot(answer.section, answer.label), answer)
        if (mode === 'exam') extracted.push(result.rows as ParsedRow[])
        else for (const answer of result.rows as KeyAnswer[]) answers.set(answerSlot(answer.section, answer.label), answer)
      }
    }
    // The paper's usual choice count is a whole-document fact, so it is
    // measured once and handed to each window's stitch.
    const byWindow = fillSections(extracted)
    const modal = modalOptionCount(byWindow.flat())
    const stitched = byWindow.flatMap((windowRows) => stitchContinuations(windowRows, modal))
    let rows = dedupe(stitched.map((row) => attachAnswer(row, answers)))
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
