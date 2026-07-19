/**
 * The step machine (CODOX_MIGRATION §1.3). The only engine file that
 * touches the controller, the PDF pipeline, and Dexie.
 *
 * Checkpointing: every step writes its inputs and outputs to `runArtifacts`
 * BEFORE the next step starts — which is also exactly what resume needs.
 * `resumeRun` re-enters at the first step whose outputs are missing, so a
 * reload, a quota pause, a connection drop, or a process kill all cost at
 * most the step in flight.
 *
 * Counters: the planner repair round and the worker chunk retry are
 * exactly one each and are consumed only by INVALID CONTENT. Quota,
 * rate-limit, and offline waits are absorbed inside the controller and
 * never touch them. A worker chunk that fails both attempts no longer
 * stops the run: it bisects into smaller requests (owner-approved
 * 2026-07-18), and a single row that still fails degrades to a blank
 * flagged row — "one bad page never crashes a job".
 */
import { blobToBytes, bytesToBase64 } from '../providers/base64'
import type { GeminiController } from '../providers/controller'
import { geminiController } from '../providers/controller'
import type { ProviderFailureCode, VisionResult } from '../providers/types'
import { cropJpeg } from '../pdf/images'
import { processPdf } from '../pdf/pipeline'
import {
  clearArtifacts,
  getArtifact,
  getArtifacts,
  getCropByPath,
  getPageArtifact,
  getRun,
  putArtifact,
  recordRequestUsage,
  updateRun,
} from '../state/runs'
import { logEvent } from '../state/diagnostics'
import type { RunArtifact } from '../state/types'
import {
  buildAuditRequest,
  buildPlannerRepairRequest,
  buildPlannerRequest,
  buildWorkerRequest,
  PLANNER_MODEL,
  WORKER_MODEL,
  wasTruncated,
  type CallImage,
} from './calls'
import {
  buildBoxBatchRequest, buildBoxRequest, buildEvidenceRequest, buildFigureDetectRequest, buildIndexRequest,
} from './calls'
import { assembleBlueprint } from './assemble'
import { mapConcurrent } from './concurrency'
import {
  localizeIndexWindow,
  reconcileIndexWindows,
  type LocalizedIndexWindow,
  type ReconciledQuestion,
} from './enumerate'
import { parseBoxResult, parseEvidenceMap, parseFigureDetection, parseIndexWindow, type BoxResult, type EvidenceMap } from './index-pass'
import type { PlanningIssue } from '../state/types'
import {
  buildReducedBlueprint,
  chunkPages,
  chunkPlannedRows,
  isUnderExtracted,
  readDeclaredCounts,
  rewriteAssetPaths,
  validateBlueprint,
} from './blueprint'
import {
  localizeWindow,
  planWindows,
  splitWindow,
  stitchBlueprints,
  type LocalizedWindow,
  type PageWindow,
} from './windows'
import { boxToCropBox, hasPositiveExtent } from './boxes'
import { emitCsv } from './csv'
import { mergeRows, validateWorkerChunk } from './merge'
import { stripEnumerationLabels, stripTableBlock } from './normalize'
import { parseAuditReport, validateFinalRows } from './validate'
import { resolveQuestionReferences } from './reference-resolver'
import { applyMatchingPolicy } from './matching'
import type { MatchingMode } from '../state/customization-settings'
import type {
  Blueprint,
  MergedRow,
  PlannedRow,
  RunStep,
  StopReason,
  WorkerRow,
} from './types'

export interface ExecutorOptions {
  controller?: GeminiController
  /** Worker chunk size (§1.9 default 10). */
  chunkSize?: number
  signal?: AbortSignal
  /** Rendered-page DPI override; production always uses the pinned 200. */
  dpi?: number
  /** Separate answer-key PDF, appended after the exam pages when declared. */
  answerKeyBytes?: Uint8Array
  /** Intake page counts make render checkpoints complete and resumable. */
  examPageCount?: number
  answerKeyPageCount?: number
  /**
   * Pages per BOX call (Customize's "Pages per box request", 1–10).
   * 1 (default) keeps the per-page pass; higher spends fewer requests.
   */
  boxPagesPerCall?: number
  /**
   * Customize's "Matching questions", default 'split'. Spends a request only
   * when a row's text actually mentions matching or pairing.
   */
  matchingMode?: MatchingMode
}

export type RunOutcome =
  | {
      status: 'done'
      runId: string
      csv: string
      flaggedRows: number
      notSafeToImport: boolean
    }
  /** A §1.3 content stop: the engine could not proceed on what it was given. */
  | { status: 'stopped'; runId: string; reason: StopReason }
  /**
   * Not a §1.3 stop — the provider itself ended the run. Kept distinct so
   * the UI can say "bad key" vs "Gemini is unreachable" (never "failed").
   * Quota and offline never land here: the controller absorbs them.
   */
  | { status: 'provider-stopped'; runId: string; kind: 'wrong-key' | 'provider-error' }
  /** Aborted (tab closed, user stopped): artifacts stand, the run resumes. */
  | { status: 'aborted'; runId: string }

const JPEG = 'image/jpeg'

/**
 * How many independent Gemini calls may be in flight at once. The shared
 * controller throttle still enforces the free-tier RPM ceiling; this only
 * removes the wait-for-the-previous-call latency between independent calls.
 * Kept small because each in-flight call holds its page images as base64 in
 * memory (mobile working-set discipline).
 */
const CALL_CONCURRENCY = 3

/** A provider failure the engine cannot continue past. */
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

/**
 * Runs one Gemini call through the controller and counts it against the
 * run's quota burn. Quota/offline pauses have already been absorbed by
 * the controller by the time this returns.
 */
async function call(
  controller: GeminiController,
  runId: string,
  request: Parameters<GeminiController['runGeminiRequest']>[0],
  signal?: AbortSignal,
): Promise<{ text: string; finishReason?: string }> {
  const result: VisionResult = await controller.runGeminiRequest(request, {
    signal,
  })
  if (!result.ok) {
    await recordRequestUsage(runId)
    if (result.kind !== 'aborted') {
      await logEvent({
        scope: 'provider', level: 'error', event: 'provider.error', runId,
        reason: result.kind, detail: result.code === undefined ? undefined : { code: result.code },
      })
    }
    throw new ProviderStop(
      result.kind === 'wrong-key'
        ? 'wrong-key'
        : result.kind === 'aborted'
          ? 'aborted'
          : 'provider-error',
      result.code,
    )
  }
  await recordRequestUsage(runId, result.usage)
  return { text: result.text, finishReason: result.finishReason }
}

/**
 * Times one unit of work and records it as a diagnostics event
 * (`engine.timing`, detail `{ label, ms }`) the debug console reads back.
 * Diagnostics only: it never changes what `fn` returns, and `logEvent`
 * itself never throws — so this is invisible to the engine's behaviour and
 * safe to wrap around any step or Gemini call. The `finally` records even a
 * failed/aborted attempt, which is exactly what "where did it get stuck"
 * needs.
 */
async function timed<T>(
  runId: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    await logEvent({
      scope: 'engine',
      level: 'info',
      event: 'engine.timing',
      runId,
      detail: { label, ms: Date.now() - start },
    })
  }
}

async function stop(runId: string, step: RunStep, reason: StopReason): Promise<RunOutcome> {
  await updateRun(runId, { status: 'stopped', step, stopReason: reason })
  await logEvent({ scope: 'engine', level: 'error', event: 'engine.stop', runId, reason, detail: { step } })
  return { status: 'stopped', runId, reason }
}

/** Page artifacts → the base64 images one call needs (re-read per call). */
async function pageImages(
  runId: string,
  pageIndexes: readonly number[],
): Promise<CallImage[]> {
  const images: CallImage[] = []
  for (const pageIndex of pageIndexes) {
    const artifact = await getPageArtifact(runId, pageIndex)
    if (artifact?.bytes === undefined) continue
    images.push({ mimeType: JPEG, base64Data: bytesToBase64(artifact.bytes) })
  }
  return images
}

async function cropImages(
  runId: string,
  paths: readonly string[],
): Promise<CallImage[]> {
  const images: CallImage[] = []
  for (const path of paths) {
    const artifact = await getCropByPath(runId, path)
    if (artifact?.bytes === undefined) continue
    images.push({ mimeType: JPEG, base64Data: bytesToBase64(artifact.bytes) })
  }
  return images
}

/** All successfully rendered pages, in order. */
async function renderedPages(runId: string): Promise<RunArtifact[]> {
  const pages = await getArtifacts(runId, 'page-jpeg')
  return pages.sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0))
}

/** 1-based page numbers, the convention the planner prompt's example uses. */
function pageNumbersOf(pages: readonly RunArtifact[]): Set<number> {
  return new Set(pages.map((page) => (page.pageIndex ?? 0) + 1))
}

// ---------------------------------------------------------------- step 1

async function stepRender(
  runId: string,
  pdfBytes: Uint8Array,
  options: ExecutorOptions,
): Promise<{
  ok: boolean
  badPages: number[]
  examPageCount: number
  answerKeyPageCount: number
}> {
  const existing = await renderedPages(runId)
  const run = await getRun(runId)
  const expectedExamPages = options.examPageCount
  const expectedAnswerKeyPages =
    options.answerKeyBytes === undefined ? 0 : options.answerKeyPageCount
  const expectedTotal =
    expectedExamPages !== undefined && expectedAnswerKeyPages !== undefined
      ? expectedExamPages + expectedAnswerKeyPages
      : run?.pageCount
  const knownFailures = run?.badPages ?? []
  const renderIsComplete =
    existing.length > 0 &&
    (expectedTotal === undefined ||
      existing.length + knownFailures.length >= expectedTotal)

  if (renderIsComplete) {
    await updateRun(runId, { pagesRendered: existing.length })
    const examPages = expectedExamPages ?? expectedTotal ?? existing.length
    return {
      ok: existing.some((page) => (page.pageIndex ?? 0) < examPages),
      badPages: knownFailures,
      examPageCount: examPages,
      answerKeyPageCount: expectedAnswerKeyPages ?? 0,
    }
  }

  // A crash can leave a partial stream on disk. Re-rendering from a clean
  // page checkpoint avoids duplicate indexes and makes completion provable.
  if (existing.length > 0) {
    await clearArtifacts(runId, 'page-jpeg')
    await clearArtifacts(runId, 'page-text')
    await updateRun(runId, { pagesRendered: 0, badPages: undefined })
  }

  let renderedCount = 0
  let examRenderedCount = 0
  const badPages: number[] = []
  const renderDocument = async (
    bytes: Uint8Array,
    pageOffset: number,
    isExam: boolean,
  ) => {
    const result = await processPdf(bytes, async (page) => {
      const pageIndex = pageOffset + page.pageIndex
      // Persist as it streams: never hold all pages in JS memory.
      await putArtifact({
        runId,
        kind: 'page-jpeg',
        pageIndex,
        width: page.width,
        height: page.height,
        bytes: await blobToBytes(page.jpeg),
      })
      if (page.text !== '') {
        await putArtifact({
          runId,
          kind: 'page-text',
          pageIndex,
          text: page.text,
        })
      }
      renderedCount += 1
      if (isExam) examRenderedCount += 1
      await updateRun(runId, {
        pageCount: expectedTotal ?? pageOffset + page.pageCount,
        pagesRendered: renderedCount,
      })
    }, { dpi: options.dpi, signal: options.signal })
    badPages.push(
      ...result.failures.map((failure) => pageOffset + failure.pageIndex),
    )
    return result.pageCount
  }

  const examPageCount = await renderDocument(pdfBytes, 0, true)
  const answerKeyPageCount =
    options.answerKeyBytes === undefined
      ? 0
      : await renderDocument(options.answerKeyBytes, examPageCount, false)
  await updateRun(runId, {
    pageCount: examPageCount + answerKeyPageCount,
    pagesRendered: renderedCount,
  })

  // Answer-key pages alone cannot rescue an unreadable exam.
  return {
    ok: examRenderedCount > 0,
    badPages,
    examPageCount,
    answerKeyPageCount,
  }
}

// ---------------------------------------------------------------- step 2/3

type PlannerStop =
  | 'planner_unparseable'
  | 'planner_invalid_after_repair'
  | 'planner_underextracted'

type WindowOutcome =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; reason: PlannerStop }
  /** The planner counted more questions than it emitted — split and re-plan. */
  | { ok: false; reason: 'underextracted' }

/**
 * Planning (§1.3 steps 2/3), paginated.
 *
 * A single planner call must emit a fully-specified row — four regions, each
 * with a bounding box — per question. On a large scan that output is enormous
 * and the model gives up rather than truncating: on a real 30-page, four-exam
 * file it reported `question_count: 108` and emitted 3 rows. So we plan in
 * page windows (see windows.ts for the core/context boundary rule) and stitch
 * deterministically. A window that still under-emits is split in half and
 * re-planned; a single page that under-emits stops the run honestly.
 *
 * A document that fits in ONE window takes exactly the old path: one call over
 * every page, no renumbering, no stitching.
 */
async function stepLegacyPlanAndValidate(
  runId: string,
  controller: GeminiController,
  signal: AbortSignal | undefined,
): Promise<
  { ok: true; blueprint: Blueprint } | { ok: false; reason: PlannerStop }
> {
  const cached = await getArtifact(runId, 'blueprint-valid')
  if (cached?.json !== undefined) {
    return { ok: true, blueprint: cached.json as Blueprint }
  }

  const pages = await renderedPages(runId)
  // The role's model is fixed in calls.ts. Never let a model-list result or a
  // provider failure swap it at runtime — retry the same model, or stop.
  const plannerModel = PLANNER_MODEL
  await updateRun(runId, { plannerModel })

  // Absolute 1-based numbers of the pages that actually rendered, in order.
  const pageNumbers = [...pageNumbersOf(pages)].sort((a, b) => a - b)

  const planWindow = async (window: PageWindow): Promise<WindowOutcome> => {
    const images = await pageImages(
      runId,
      window.context.map((page) => page - 1),
    )
    // The planner numbers the images it is handed 1..n, so its page
    // references are window-relative; localizeWindow maps them back.
    const relative = new Set(window.context.map((_page, index) => index + 1))
    return planOneWindow(runId, controller, images, relative, plannerModel, signal)
  }

  const windows = planWindows(pageNumbers)

  if (windows.length <= 1) {
    const result = await planWindow(windows[0])
    if (!result.ok) {
      return {
        ok: false,
        reason:
          result.reason === 'underextracted'
            ? 'planner_underextracted'
            : result.reason,
      }
    }
    // Code owns paths: the crops we produce are JPEG (§1.4, PHASE6 §5).
    const blueprint = rewriteAssetPaths(result.blueprint)
    await putArtifact({ runId, kind: 'blueprint-valid', json: blueprint })
    return { ok: true, blueprint }
  }

  // Windows are queued in page order and a split preserves that order, so the
  // stitched rows come out in document reading order.
  const localized: LocalizedWindow[] = []
  const queue = [...windows]
  while (queue.length > 0) {
    const window = queue.shift() as PageWindow
    const result = await planWindow(window)
    if (result.ok) {
      localized.push(localizeWindow(result.blueprint, window))
      continue
    }
    if (result.reason !== 'underextracted') {
      return { ok: false, reason: result.reason }
    }
    const halves = splitWindow(window, pageNumbers)
    // A single page that still under-emits cannot be split further. Stop
    // honestly rather than emit a CSV missing most of the exam.
    if (halves.length === 0) {
      return { ok: false, reason: 'planner_underextracted' }
    }
    queue.unshift(...halves)
  }

  const blueprint = rewriteAssetPaths(
    stitchBlueprints(localized, pageNumbers.length),
  )
  await putArtifact({ runId, kind: 'blueprint-valid', json: blueprint })
  return { ok: true, blueprint }
}

/** One window's planning attempt (planner call + one repair round). */
async function planOneWindow(
  runId: string,
  controller: GeminiController,
  images: readonly CallImage[],
  pageNumbers: Set<number>,
  plannerModel: string,
  signal: AbortSignal | undefined,
): Promise<WindowOutcome> {
  const planner = await call(
    controller,
    runId,
    buildPlannerRequest(images, plannerModel),
    signal,
  )
  await putArtifact({ runId, kind: 'blueprint-raw', text: planner.text })

  // Gate: JSON parses, no truncation, required fields present.
  if (wasTruncated(planner.finishReason)) {
    return { ok: false, reason: 'planner_unparseable' }
  }

  // The under-emission guard. Counting more questions than it emitted rows for
  // means the planner gave up mid-enumeration. Do NOT hand that to the repair
  // round: the repair "fixes" the mismatch by rewriting question_count down to
  // the number of rows, which is exactly how a 108-question exam silently
  // shipped as 3 rows. Split the window and re-plan instead.
  const declared = readDeclaredCounts(planner.text).questionCount
  if (isUnderExtracted(planner.text)) {
    return { ok: false, reason: 'underextracted' }
  }

  let validation = validateBlueprint(planner.text, pageNumbers)

  if (!validation.ok) {
    // Exactly one repair round — same model, original pages, the invalid
    // blueprint, the errors. Consumed only by invalid CONTENT.
    const repair = await call(
      controller,
      runId,
      buildPlannerRepairRequest(
        images,
        planner.text,
        validation.errors,
        plannerModel,
      ),
      signal,
    )
    await putArtifact({ runId, kind: 'blueprint-raw', text: repair.text })
    if (wasTruncated(repair.finishReason)) {
      return { ok: false, reason: 'planner_invalid_after_repair' }
    }
    // A repair may never talk the question count DOWN to make the row count
    // agree: question_count is what the planner SAW, not a field to negotiate.
    const repaired = readDeclaredCounts(repair.text).questionCount
    if (
      isUnderExtracted(repair.text) ||
      (declared !== undefined && repaired !== undefined && repaired < declared)
    ) {
      return { ok: false, reason: 'underextracted' }
    }
    validation = validateBlueprint(repair.text, pageNumbers)
    if (!validation.ok) {
      // Stop BEFORE any worker call.
      return { ok: false, reason: 'planner_invalid_after_repair' }
    }
  }

  return { ok: true, blueprint: validation.blueprint }
}

// ---------------------------------------------------------------- step 4

/** New enumerate-first planner. Legacy blueprints remain readable only as a
 * checkpoint compatibility fallback, never as a new request format. */
async function stepPlanAndValidate(
  runId: string, controller: GeminiController, signal: AbortSignal | undefined,
  examPageCount?: number, answerKeyPageCount = 0, boxPagesPerCall = 1,
): Promise<{ ok: true; blueprint: Blueprint } | { ok: false; reason: PlannerStop }> {
  const cached = await getArtifact(runId, 'blueprint-valid')
  if (cached?.json !== undefined) return { ok: true, blueprint: cached.json as Blueprint }
  const allPages = await renderedPages(runId)
  const examPages = allPages
    .map((page) => (page.pageIndex ?? 0) + 1)
    .filter((page) => examPageCount === undefined || page <= examPageCount)
    .sort((a, b) => a - b)
  if (examPages.length === 0) return { ok: false, reason: 'planner_unparseable' }
  const windows = planWindows(examPages)
  await updateRun(runId, { plannerModel: PLANNER_MODEL, plannerWindowCount: windows.length, plannerWindowsDone: 0 })
  const indexed: LocalizedIndexWindow[] = []
  const issues: PlanningIssue[] = []
  // INDEX windows are independent — reconciliation is deterministic and runs
  // after all of them — so they go out concurrently under the shared RPM
  // throttle. Outcomes are processed in window order below, so the stitched
  // result is identical to the sequential path. Progress counts completions.
  let indexWindowsDone = 0
  const indexOutcomes = await mapConcurrent(windows, CALL_CONCURRENCY, async (window, index) => {
    const images = await pageImages(runId, window.context.map((page) => page - 1))
    const response = await timed(runId, `index w${index + 1}`, () => call(controller, runId, buildIndexRequest(
      images, window.core.map((page) => window.context.indexOf(page) + 1), PLANNER_MODEL,
    ), signal))
    await putArtifact({ runId, kind: 'index-window', chunkIndex: index, text: response.text })
    indexWindowsDone += 1
    await updateRun(runId, { plannerWindowsDone: indexWindowsDone })
    return { response, parsed: wasTruncated(response.finishReason) ? undefined : parseIndexWindow(response.text) }
  })
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index]
    const { response, parsed } = indexOutcomes[index]
    if (parsed === undefined || !parsed.ok) {
      // A checkpoint from the pre-redesign planner is still a valid, safe
      // Blueprint. Accept it without consuming a second call so interrupted
      // older runs and their regression fixtures remain resumable.
      if (windows.length === 1) {
        const legacy = validateBlueprint(response.text, new Set(window.context.map((_page, relative) => relative + 1)))
        if (legacy.ok) {
          const blueprint = rewriteAssetPaths(legacy.blueprint)
          await putArtifact({ runId, kind: 'blueprint-raw', text: response.text })
          await putArtifact({ runId, kind: 'blueprint-valid', json: blueprint })
          return { ok: true, blueprint }
        }
      }
      // An unresolved window is a visible non-fatal planning issue on its
      // core pages, never a silent gap in the exam.
      issues.push(...window.core.map((page) => ({ kind: 'unreadable_page' as const, page })))
      continue
    }
    indexed.push(localizeIndexWindow(parsed.value, window.context, window.core, index))
  }
  const reconciled = reconcileIndexWindows(indexed)
  issues.push(...reconciled.issues)
  const emitted = indexed.reduce((total, window) => total + window.questions.length + window.disowned.length, 0)
  await logEvent({
    scope: 'engine',
    level: reconciled.questions.length === 0 ? 'error' : 'info',
    event: 'engine.index.reconciled', runId,
    // `emitted` vs `questions` is the under-extraction signal: reconciliation
    // removing far more than the window overlap explains means a dedup rule
    // is eating real questions, which is otherwise invisible in the log.
    detail: {
      questions: reconciled.questions.length,
      emitted,
      dropped: reconciled.drops.length,
      issues: reconciled.issues.length,
    },
  })
  if (reconciled.drops.length > 0) {
    await logEvent({
      scope: 'engine',
      level: 'info',
      event: 'engine.index.dropped', runId,
      detail: { drops: reconciled.drops },
    })
  }
  if (reconciled.questions.length === 0) {
    // Makes existing interrupted runs and old test fixtures resumable; fresh
    // calls always use INDEX above.
    return stepLegacyPlanAndValidate(runId, controller, signal)
  }

  const defaultEvidence: EvidenceMap = {
    type: reconciled.questions.some((row) => row.evidenceState === 'inline') ? 'inline_marks' : 'no_answer_key',
    markingStyle: '', evidence: [],
  }
  const runEvidence = async (): Promise<EvidenceMap> => {
    if (answerKeyPageCount <= 0 || examPageCount === undefined) return defaultEvidence
    const keyPages = allPages.map((page) => (page.pageIndex ?? 0) + 1).filter((page) => page > examPageCount)
    const response = await timed(runId, 'evidence', async () => call(controller, runId, buildEvidenceRequest(
      await pageImages(runId, keyPages.map((page) => page - 1)),
      reconciled.questions.map((row) => ({ ref: row.ref, printedLabel: row.printedLabel, section: row.sectionKey })),
      PLANNER_MODEL,
    ), signal))
    const parsed = wasTruncated(response.finishReason) ? undefined : parseEvidenceMap(response.text)
    return parsed?.ok ? parsed.value : defaultEvidence
  }

  // Detection is independent of INDEX's observation, so a false index flag
  // cannot suppress a visual. Its result is checkpointed for diagnostics.
  const runFigureDetect = () => mapConcurrent(windows, CALL_CONCURRENCY, async (window, index) => {
    const response = await timed(runId, `figure w${index + 1}`, async () => call(controller, runId, buildFigureDetectRequest(
      await pageImages(runId, window.context.map((page) => page - 1)),
      reconciled.questions.filter((row) => window.core.includes(row.ownerPage)).map((row) => ({ ref: row.ref, ownerPage: row.ownerPage })),
      PLANNER_MODEL,
    ), signal))
    await putArtifact({ runId, kind: 'figure-window', chunkIndex: index, text: response.text })
    if (!wasTruncated(response.finishReason)) parseFigureDetection(response.text)
  })

  const byPage = new Map<number, typeof reconciled.questions>()
  for (const question of reconciled.questions) {
    const list = byPage.get(question.ownerPage) ?? []
    list.push(question); byPage.set(question.ownerPage, list)
  }
  const onPage = <T extends { page: number }>(value: T, page: number): T => ({ ...value, page })
  // BOX batches of question-bearing pages (Customize's "Pages per box
  // request"; 1 keeps today's per-page pass). A ref the model silently omits
  // becomes a blank review card downstream, so a batch keeps retrying the
  // refs the last pass dropped (BOX_ATTEMPTS total) before those refs are
  // flagged and left to the whole-page fallback. A full failure
  // (truncation/parse error) is retried the same way.
  const BOX_ATTEMPTS = 2
  const batchSize = Math.max(1, Math.min(10, Math.floor(boxPagesPerCall)))
  const pageEntries = [...byPage.entries()]
  const batches: Array<typeof pageEntries> = []
  for (let start = 0; start < pageEntries.length; start += batchSize) {
    batches.push(pageEntries.slice(start, start + batchSize))
  }
  const boxAttempt = async (batchPages: readonly number[], refs: readonly ReconciledQuestion[], attempt: number) => {
    const span = batchPages.length > 1 ? `-${batchPages[batchPages.length - 1]}` : ''
    const response = await timed(runId, `box p${batchPages[0]}${span}${attempt > 0 ? ` retry${attempt}` : ''}`, async () => {
      const images = await pageImages(runId, batchPages.map((page) => page - 1))
      const tasks = refs.map((row) => ({
        ref: row.ref,
        printedLabel: row.printedLabel,
        anchor: row.anchor,
        optionsPresent: row.optionsPresent,
        hasCase: row.caseStemKey !== null,
        hasInlineEvidence: row.evidenceState === 'inline'
      }))
      const request = batchPages.length === 1
        ? buildBoxRequest(images, tasks, PLANNER_MODEL)
        : buildBoxBatchRequest(images, tasks.map((task, index) => ({
            ...task, page: batchPages.indexOf(refs[index].ownerPage) + 1,
          })), PLANNER_MODEL)
      return call(controller, runId, request, signal)
    })
    const parsed = wasTruncated(response.finishReason) ? undefined : parseBoxResult(response.text)
    return { response, parsed }
  }
  // Each batch task returns its own findings; they are folded back in page
  // order below, so asset numbering and issue order never depend on which
  // call happened to finish first.
  const runBoxBatches = () => mapConcurrent(batches, CALL_CONCURRENCY, async (batch) => {
    const batchPages = batch.map(([page]) => page)
    const found: BoxResult['questions'] = []
    const figures: BoxResult['figures'] = []
    const pageIssues: PlanningIssue[] = []
    // Batched figures report the relative image number; a lone page keeps
    // the code-owned stamp exactly as before.
    const absoluteFigurePage = (relative: number): number | undefined =>
      batchPages.length === 1 ? batchPages[0] : batchPages[relative - 1]
    let remaining: readonly ReconciledQuestion[] = batch.flatMap(([, questions]) => questions)
    let figuresCaptured = false
    let lastReason = 'no box region after retry'
    for (let attempt = 0; attempt < BOX_ATTEMPTS && remaining.length > 0; attempt += 1) {
      const { response, parsed } = await boxAttempt(batchPages, remaining, attempt)
      if (parsed === undefined || !parsed.ok) {
        lastReason = parsed === undefined ? 'BOX response was truncated' : parsed.errors.join('; ')
        await logEvent({ scope: 'engine', level: 'warn', event: 'engine.box.page.fail', runId, page: batchPages[0], reason: lastReason, detail: { attempt, pages: batchPages, rawResponse: response.text } })
        continue
      }
      const ownerByRef = new Map(remaining.map((row) => [row.ref, row.ownerPage]))
      const boxedNow = parsed.value.questions.filter((row) => ownerByRef.has(row.ref))
      found.push(...boxedNow.map((row) => {
        // Question regions are stamped with the ref's known owner page —
        // code-owned, never the model's page field.
        const owner = ownerByRef.get(row.ref) as number
        return {
          ...row, question: onPage(row.question, owner), options: row.options === null ? null : onPage(row.options, owner),
          caseStem: row.caseStem === null ? null : onPage(row.caseStem, owner),
          inlineEvidence: row.inlineEvidence === null ? null : onPage(row.inlineEvidence, owner),
        }
      }))
      // Figures cover the whole batch, not just the requested refs; capture
      // them once so a retry pass cannot duplicate an asset. A figure whose
      // page falls outside the batch is dropped — its rows keep their text
      // (NEVER-GUESS covers invented pages too).
      if (!figuresCaptured) {
        figures.push(...parsed.value.figures.flatMap((row) => {
          const page = absoluteFigurePage(row.page)
          return page === undefined ? [] : [{ ...row, page }]
        }))
        figuresCaptured = true
      }
      const foundRefs = new Set(boxedNow.map((row) => row.ref))
      remaining = remaining.filter((row) => !foundRefs.has(row.ref))
    }
    if (remaining.length > 0) {
      pageIssues.push(...remaining.map((row) => ({ kind: 'unreadable_page' as const, page: row.ownerPage, rowRef: row.ref, reason: lastReason })))
    }
    return { found, figures, pageIssues }
  })

  // Evidence, figure detection, and BOX share no inputs beyond the
  // reconciled index and never read each other's outputs (they only meet in
  // assembleBlueprint), so the three passes overlap.
  const [evidence, , boxOutcomes] = await Promise.all([
    runEvidence(),
    runFigureDetect(),
    runBoxBatches(),
  ])
  const allBoxes: BoxResult = { questions: [], figures: [] }
  for (const outcome of boxOutcomes) {
    allBoxes.questions.push(...outcome.found)
    allBoxes.figures.push(...outcome.figures)
    issues.push(...outcome.pageIssues)
  }
  const boxedRefs = new Set(allBoxes.questions.map((q) => q.ref))
  const flaggedRefs = new Set(issues.flatMap((issue) => (issue.rowRef !== undefined ? [issue.rowRef] : [])))
  for (const question of reconciled.questions) {
    if (!boxedRefs.has(question.ref) && !flaggedRefs.has(question.ref)) {
      issues.push({ kind: 'unreadable_page', page: question.ownerPage, rowRef: question.ref, reason: 'no box region — row recovered from the full page; verify' })
    }
  }
  const blueprint = rewriteAssetPaths(assembleBlueprint({ index: reconciled, boxes: allBoxes, evidence, pageCount: examPages.length }))
  const valid = validateBlueprint(JSON.stringify(blueprint), new Set(examPages))
  if (!valid.ok) return { ok: false, reason: 'planner_invalid_after_repair' }
  await putArtifact({ runId, kind: 'index-reconcile', json: { ...reconciled, issues } })
  await putArtifact({ runId, kind: 'blueprint-valid', json: blueprint })
  await updateRun(runId, { planningIssues: issues.length === 0 ? undefined : issues })
  await logEvent({
    scope: 'engine', level: issues.length === 0 ? 'info' : 'warn', event: 'engine.blueprint', runId,
    detail: { rows: blueprint.planned_rows.length, planningIssues: issues.length },
  })
  return { ok: true, blueprint }
}


/**
 * Deterministic crops from planner boxes. The cropper never adjusts a box
 * (clamping to page bounds is the only allowed adjustment). A missing or
 * degenerate referenced asset does not stop the run — it marks it
 * `not_safe_to_import` and continues.
 */
async function stepCrops(
  runId: string,
  blueprint: Blueprint,
): Promise<{ producedCrops: Set<string>; cropFailures: string[] }> {
  const existing = await getArtifacts(runId, 'crop')
  const produced = new Set(
    existing.flatMap((crop) => (crop.path !== undefined ? [crop.path] : [])),
  )
  const cropFailures: string[] = []
  const referenced = new Set(
    blueprint.planned_rows.flatMap((row) => row.image_urls),
  )

  for (const asset of blueprint.assets) {
    if (produced.has(asset.output_path)) continue
    const pageIndex = asset.page - 1
    const page = await getPageArtifact(runId, pageIndex)
    if (page?.bytes === undefined || page.width === undefined || page.height === undefined) {
      cropFailures.push(`asset "${asset.asset_id}": page ${asset.page} did not render`)
      continue
    }
    if (!hasPositiveExtent(asset.box_2d)) {
      cropFailures.push(`asset "${asset.asset_id}": degenerate box`)
      continue
    }
    try {
      const box = boxToCropBox(asset.box_2d, page.width, page.height)
      const pageJpeg = new Blob([page.bytes as BlobPart], { type: JPEG })
      const cropped = await cropJpeg(pageJpeg, box)
      await putArtifact({
        runId,
        kind: 'crop',
        pageIndex,
        path: asset.output_path,
        bytes: await blobToBytes(cropped),
      })
      produced.add(asset.output_path)
    } catch (error) {
      cropFailures.push(
        `asset "${asset.asset_id}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Only a crop a ROW references makes the run unsafe (§1.3 step 4 gate).
  const missing = [...referenced].filter((path) => !produced.has(path))
  for (const path of missing) {
    cropFailures.push(`referenced crop "${path}" was not produced`)
  }
  return { producedCrops: produced, cropFailures }
}

// ---------------------------------------------------------------- step 5

/**
 * What a row degrades to when the worker could not answer for it at any
 * granularity: everything blank. NEVER-GUESS — the merge-step gates flag
 * the emptiness (`empty_question`/`incomplete_options`) so the row reaches
 * Review pointing at its page instead of killing the other rows' run.
 */
export function placeholderWorkerRow(planned: PlannedRow): WorkerRow {
  return {
    id: planned.id,
    group_id: planned.group_id,
    topic: planned.topic,
    subtopic: planned.subtopic,
    year: planned.year,
    case_stem: '',
    question: '',
    options: [],
    correct_index: '',
    image_urls: [...planned.image_urls],
    needs_review: '',
  }
}

/**
 * Worker rows the transcription model clearly cut short: the blueprint says
 * the question has options, but fewer than two came back. No multiple-choice
 * item — not even True/False — has one option, so <2 is an unambiguous
 * under-transcription (the weakest model abbreviating a long chunk), never a
 * genuinely short question. Partial drops (3–4 of 5) are indistinguishable
 * from real short questions and are left to the chunk-size lever, not guessed.
 */
export function underTranscribedRowIds(
  blueprint: Blueprint,
  rows: readonly WorkerRow[],
): string[] {
  const hasOptions = new Set(
    blueprint.planned_rows
      .filter((row) => row.regions.options !== null)
      .map((row) => row.id),
  )
  return rows
    .filter((row) => hasOptions.has(row.id) && row.options.length < 2)
    .map((row) => row.id)
}

/**
 * Re-asks each under-transcribed row on its own. A single-row request keeps
 * the worker's output short, so its options come back whole; the fuller result
 * replaces the clipped one (never a shorter one — a re-ask that came back worse
 * is discarded). Rows still short afterward are left untouched and flagged
 * downstream, never silently shipped.
 */
async function repairUnderTranscribedRows(
  runId: string,
  blueprint: Blueprint,
  rows: WorkerRow[],
  controller: GeminiController,
  workerModel: string,
  signal: AbortSignal | undefined,
  skipIds: ReadonlySet<string> = new Set(),
): Promise<WorkerRow[]> {
  // Rows that already failed their own single-row requests during the chunk
  // split are not re-asked here — that attempt was just made.
  const brokenIds = underTranscribedRowIds(blueprint, rows).filter(
    (id) => !skipIds.has(id),
  )
  if (brokenIds.length === 0) return rows
  await logEvent({
    scope: 'engine', level: 'info', event: 'engine.worker.repair', runId,
    detail: { count: brokenIds.length, ids: brokenIds },
  })
  const plannedById = new Map(blueprint.planned_rows.map((row) => [row.id, row]))
  const byId = new Map(rows.map((row) => [row.id, row]))
  await mapConcurrent(brokenIds, CALL_CONCURRENCY, async (id) => {
    const planned = plannedById.get(id)
    const current = byId.get(id)
    if (planned === undefined || current === undefined) return
    const reduced = buildReducedBlueprint(blueprint, [planned])
    const images = [
      ...(await pageImages(runId, chunkPages(reduced).map((page) => page - 1))),
      ...(await cropImages(runId, reduced.assets.map((asset) => asset.output_path))),
    ]
    const response = await timed(runId, `worker repair ${id}`, () =>
      call(controller, runId, buildWorkerRequest(reduced, images, workerModel), signal),
    )
    if (wasTruncated(response.finishReason)) return
    const validation = validateWorkerChunk(response.text, [planned])
    if (validation.ok && validation.rows[0] !== undefined &&
        validation.rows[0].options.length > current.options.length) {
      byId.set(id, validation.rows[0])
    }
  })
  return rows.map((row) => byId.get(row.id) ?? row)
}

async function stepWorker(
  runId: string,
  blueprint: Blueprint,
  controller: GeminiController,
  workerModel: string,
  chunkSize: number,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; rows: WorkerRow[] } | { ok: false }> {
  const chunks = chunkPlannedRows(blueprint, chunkSize)
  const done = await getArtifacts(runId, 'chunk-response')
  const byChunk = new Map(
    done.flatMap((artifact) =>
      artifact.chunkIndex !== undefined ? [[artifact.chunkIndex, artifact]] : [],
    ),
  )

  await updateRun(runId, { chunkCount: chunks.length, chunksDone: 0 })

  // Chunks never read each other's output (merge runs after all of them), so
  // they go out concurrently. Results are flattened in chunk order, keeping
  // the merged row order identical to the sequential path. Progress counts
  // completions, not positions.
  let chunksCompleted = 0
  const finishChunk = async <T>(result: T): Promise<T> => {
    chunksCompleted += 1
    await updateRun(runId, { chunksDone: chunksCompleted })
    return result
  }

  /**
   * One worker request for `rows` — two attempts, the second consumed only
   * by INVALID CONTENT (or truncation). The raw response is checkpointed
   * only for whole-chunk requests (`artifactChunkIndex`), where resume can
   * replay it; split slices are cheap enough to redo.
   */
  const requestRows = async (
    rows: readonly PlannedRow[],
    label: string,
    artifactChunkIndex?: number,
  ): Promise<
    | { ok: true; rows: WorkerRow[] }
    | { ok: false; reason?: string; finishReason?: string; rawResponse?: string }
  > => {
    const reduced = buildReducedBlueprint(blueprint, rows)
    const pages = chunkPages(reduced).map((page) => page - 1)
    const cropPaths = reduced.assets.map((asset) => asset.output_path)
    const images = [
      ...(await pageImages(runId, pages)),
      ...(await cropImages(runId, cropPaths)),
    ]
    let previousError: string | undefined
    let last: { text: string; finishReason?: string } | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await timed(runId, label, () =>
        call(
          controller,
          runId,
          buildWorkerRequest(reduced, images, workerModel, previousError),
          signal,
        ),
      )
      last = response
      if (artifactChunkIndex !== undefined) {
        await putArtifact({
          runId,
          kind: 'chunk-response',
          chunkIndex: artifactChunkIndex,
          text: response.text,
        })
      }
      if (wasTruncated(response.finishReason)) {
        previousError = 'your response was truncated; return fewer characters'
        continue
      }
      const validation = validateWorkerChunk(response.text, rows)
      if (validation.ok) return { ok: true, rows: validation.rows }
      previousError = validation.errors.join('; ')
    }
    return {
      ok: false,
      reason: previousError,
      finishReason: last?.finishReason,
      rawResponse: last?.text,
    }
  }

  /**
   * A failed request bisects instead of stopping the run (owner-approved
   * 2026-07-18): a smaller slice is a genuinely different request — fewer
   * rows, fewer page images — which isolates whatever poisoned the batch
   * (an empty safety-blocked response was observed killing an entire
   * 89-row run over one chunk). A single row that still fails degrades to
   * a blank placeholder the merge gates flag for Review. Halves run
   * sequentially so row order is preserved.
   */
  const transcribeSlice = async (
    chunkRows: readonly PlannedRow[],
    chunkIndex: number,
    lo: number,
    hi: number,
  ): Promise<{ rows: WorkerRow[]; failedIds: string[]; split: boolean }> => {
    const slice = chunkRows.slice(lo, hi)
    const whole = lo === 0 && hi === chunkRows.length
    const label = whole
      ? `worker chunk ${chunkIndex + 1}`
      : `worker chunk ${chunkIndex + 1} rows ${lo + 1}-${hi}`
    const result = await requestRows(slice, label, whole ? chunkIndex : undefined)
    if (result.ok) return { rows: result.rows, failedIds: [], split: false }
    if (slice.length === 1) {
      // The stop reason alone is undiagnosable from an exported diagnostics
      // log — record why the row failed and what the model actually
      // returned (logEvent truncates long strings).
      await logEvent({
        scope: 'engine', level: 'error', event: 'engine.worker.row.fail', runId,
        reason: result.reason,
        detail: {
          chunk: chunkIndex + 1, id: slice[0].id,
          finishReason: result.finishReason, rawResponse: result.rawResponse,
        },
      })
      return {
        rows: [placeholderWorkerRow(slice[0])],
        failedIds: [slice[0].id],
        split: true,
      }
    }
    await logEvent({
      scope: 'engine', level: 'warn', event: 'engine.worker.chunk.split', runId,
      reason: result.reason,
      detail: {
        chunk: chunkIndex + 1, rows: slice.length,
        finishReason: result.finishReason, rawResponse: result.rawResponse,
      },
    })
    const mid = lo + Math.ceil(slice.length / 2)
    const left = await transcribeSlice(chunkRows, chunkIndex, lo, mid)
    const right = await transcribeSlice(chunkRows, chunkIndex, mid, hi)
    return {
      rows: [...left.rows, ...right.rows],
      failedIds: [...left.failedIds, ...right.failedIds],
      split: true,
    }
  }

  const chunkResults = await mapConcurrent(
    chunks,
    CALL_CONCURRENCY,
    async (chunkRows, chunkIndex) => {
      // Resume: a chunk already answered and validated is not re-sent.
      const cached = byChunk.get(chunkIndex)
      if (cached?.text !== undefined) {
        const replay = validateWorkerChunk(cached.text, chunkRows)
        if (replay.ok) {
          return finishChunk({ rows: replay.rows, failedIds: [] as string[] })
        }
        // Drop only this chunk's stale response — the other chunks' cached
        // responses must survive for the next resume.
        await clearArtifacts(runId, 'chunk-response', chunkIndex)
      }

      const reduced = buildReducedBlueprint(blueprint, chunkRows)
      await putArtifact({
        runId,
        kind: 'chunk-request',
        chunkIndex,
        json: {
          reduced,
          pages: chunkPages(reduced).map((page) => page - 1),
          cropPaths: reduced.assets.map((asset) => asset.output_path),
          workerModel,
        },
      })

      const result = await transcribeSlice(chunkRows, chunkIndex, 0, chunkRows.length)
      if (result.split) {
        // The stored raw response is the invalid whole-chunk attempt; replace
        // it with the assembled outcome so a resume replays instead of
        // re-spending the split. Placeholder rows replay as-is — they were
        // already retried at every granularity.
        await putArtifact({
          runId,
          kind: 'chunk-response',
          chunkIndex,
          text: JSON.stringify({ rows: result.rows }),
        })
      }
      return finishChunk(result)
    },
  )

  const flatRows = chunkResults.flatMap((result) => result.rows)
  const failedIds = new Set(chunkResults.flatMap((result) => result.failedIds))
  if (failedIds.size > 0) {
    await logEvent({
      scope: 'engine', level: 'warn', event: 'engine.worker.rows.failed', runId,
      detail: { count: failedIds.size, ids: [...failedIds] },
    })
  }
  // Every row failing every granularity is a systemic provider/content
  // problem, not "one bad page" — an honest stop beats an all-blank export.
  if (flatRows.length > 0 && failedIds.size === flatRows.length) {
    return { ok: false }
  }

  const rows = await repairUnderTranscribedRows(
    runId, blueprint, flatRows, controller, workerModel, signal, failedIds,
  )
  return { ok: true, rows }
}

// ---------------------------------------------------------------- the run

/**
 * Runs (or resumes) one exam PDF end to end. Every step checkpoints, so
 * calling this again on an interrupted run picks up at the first step
 * whose outputs are missing.
 */
export async function executeRun(
  runId: string,
  pdfBytes: Uint8Array,
  options: ExecutorOptions = {},
): Promise<RunOutcome> {
  const controller = options.controller ?? geminiController
  const chunkSize = options.chunkSize ?? 10
  const matchingMode = options.matchingMode ?? 'split'
  const { signal } = options

  await updateRun(runId, { status: 'running' })

  try {
    // 1 — render
    await updateRun(runId, { step: 'render', stepStartedAt: Date.now() })
    const render = await timed(runId, 'render', () =>
      stepRender(runId, pdfBytes, options),
    )
    if (!render.ok) return stop(runId, 'render', 'render_failed')
    if (render.badPages.length > 0) {
      await updateRun(runId, { badPages: render.badPages })
    }

    // 2/3 — planner + blueprint validation (one repair round)
    await updateRun(runId, { step: 'planner', stepStartedAt: Date.now() })
    const planned = await stepPlanAndValidate(
      runId, controller, signal, render.examPageCount, render.answerKeyPageCount,
      options.boxPagesPerCall,
    )
    if (!planned.ok) return stop(runId, 'planner', planned.reason)
    const blueprint = planned.blueprint

    // 4 — deterministic crops
    await updateRun(runId, { step: 'crops', stepStartedAt: Date.now() })
    const { producedCrops, cropFailures } = await timed(runId, 'crops', () =>
      stepCrops(runId, blueprint),
    )
    let notSafeToImport = cropFailures.length > 0 || ((await getRun(runId))?.planningIssues?.length ?? 0) > 0
    if (cropFailures.length > 0) {
      await logEvent({ scope: 'engine', level: 'warn', event: 'engine.crops.failed', runId, detail: { count: cropFailures.length } })
    }

    // 5 — chunked worker calls
    await updateRun(runId, { step: 'worker', stepStartedAt: Date.now() })
    const worker = await stepWorker(
      runId,
      blueprint,
      controller,
      WORKER_MODEL,
      chunkSize,
      signal,
    )
    if (!worker.ok) return stop(runId, 'worker', 'worker_chunk_invalid')

    // 6 — deterministic merge, then normalization
    await updateRun(runId, { step: 'merge', stepStartedAt: Date.now() })
    const merged = await timed(runId, 'merge', async () =>
      mergeRows(blueprint, worker.rows),
    )
    if (!merged.ok) return stop(runId, 'merge', 'merge_validation_failed')

    const resolvedRows = await timed(runId, 'reference-resolver', async () =>
      resolveQuestionReferences(merged.rows, controller, runId, signal),
    )

    // Options-bearing rows the worker (and its repair re-ask) still returned
    // with a single option: an unambiguous transcription defect. Flag them so a
    // one-option question is surfaced for review, never shipped silently — this
    // matters most for answered exams, where the row would otherwise carry a
    // real correct_index and pass unflagged.
    const optionsPresentIds = new Set(
      blueprint.planned_rows
        .filter((planned) => planned.regions.options !== null)
        .map((planned) => planned.id),
    )
    const rows: MergedRow[] = resolvedRows.map((row) => {
      const normalized = stripEnumerationLabels(row.options)
      const incompleteOptions =
        optionsPresentIds.has(row.id) && normalized.options.length < 2
      // `question` was assembled and label-stripped deterministically at merge
      // (case_stem + prompt, §2.2). When the row carries a figure crop that
      // actually rendered, drop a linearized GFM table from the stem: the table
      // ships as the image asset, so the pipe-text is redundant noise on the
      // Triviadox card. Guarded on a *produced* crop — a planned-but-failed crop
      // (path present, bytes missing) must NOT trigger deletion, or the card
      // loses the table entirely. With no working image the text is the table's
      // only copy and is kept (NEVER-GUESS covers deletion too).
      const hasCrop = row.image_urls.some((path) => producedCrops.has(path))
      const question = hasCrop ? stripTableBlock(row.question) : row.question
      // A row whose prompt read back empty is flagged, never a silent blank
      // card: BOX failed on that page and the whole-page fallback yielded no
      // text. NEVER-GUESS — a flag pointing at the page beats an empty row.
      const emptyQuestion = question.trim() === ''
      return {
        ...row,
        question,
        options: normalized.options,
        // A one-option row is the most urgent defect (the tutor must restore
        // the choices), so it wins over an existing policy flag; then empties,
        // then ambiguous labels. The blank-answer flag re-surfaces on its own
        // (correct_index stays empty), so nothing is lost.
        needs_review: incompleteOptions
          ? 'incomplete_options'
          : row.needs_review !== ''
            ? row.needs_review
            : emptyQuestion
              ? 'empty_question'
              : normalized.ambiguous
                ? 'possible_merge'
                : '',
      }
    })

    const emptyQuestions = rows.filter((row) => row.needs_review === 'empty_question').length
    if (emptyQuestions > 0) {
      await logEvent({ scope: 'engine', level: 'warn', event: 'engine.empty_questions', runId, detail: { count: emptyQuestions } })
    }

    await putArtifact({ runId, kind: 'merged-rows', json: rows })

    // 7 — final validation + CSV emit. A failure still writes the CSV.
    await updateRun(runId, { step: 'emit', stepStartedAt: Date.now() })
    let csv = await timed(runId, 'emit', async () => {
      const final = validateFinalRows(rows, blueprint, producedCrops)
      if (!final.ok) notSafeToImport = true
      return emitCsv(rows)
    })
    await putArtifact({ runId, kind: 'csv', text: csv })

    // 8 — the read-only audit gate
    await updateRun(runId, { step: 'audit', stepStartedAt: Date.now() })
    let auditUnavailable = false
    try {
      const auditImages = [
        ...(await pageImages(
          runId,
          (await renderedPages(runId)).map((page) => page.pageIndex ?? 0),
        )),
        ...(await cropImages(runId, [...producedCrops])),
      ]
      const audit = await timed(runId, 'audit', () =>
        call(
          controller,
          runId,
          buildAuditRequest(blueprint, rows, auditImages),
          signal,
        ),
      )
      const report = parseAuditReport(audit.text)
      if (report.ok) {
        await putArtifact({ runId, kind: 'audit-report', json: report.report })
        if (!report.report.audit_pass) notSafeToImport = true
      } else {
        // The audit call answered but not in the contract shape → the
        // audit is unavailable. NEVER an inferred pass.
        auditUnavailable = true
        notSafeToImport = true
        await putArtifact({
          runId,
          kind: 'audit-report',
          json: { audit_unavailable: report.errors },
        })
      }
    } catch (error) {
      if (error instanceof ProviderStop && error.kind === 'aborted') throw error
      auditUnavailable = true
      notSafeToImport = true
      await putArtifact({
        runId,
        kind: 'audit-report',
        json: {
          audit_unavailable:
            error instanceof Error ? error.message : String(error),
        },
      })
    }

    await logEvent({
      scope: 'engine', level: auditUnavailable || notSafeToImport ? 'warn' : 'info', event: 'engine.audit', runId,
      detail: { auditUnavailable, notSafeToImport },
    })

    // 9 — matching-question policy (Customize). Deliberately after the audit:
    // a matching row changes the row count, so running it earlier would break
    // the blueprint-to-rows 1:1 that validation and the audit gate depend on.
    // Here the rows have already been verified against the source pages, and
    // this pass only re-shapes text that was verified verbatim.
    const finalRows = await timed(runId, 'matching', () =>
      applyMatchingPolicy(rows, matchingMode, controller, runId, signal),
    )
    if (finalRows !== rows) {
      await putArtifact({ runId, kind: 'merged-rows', json: finalRows })
      csv = emitCsv(finalRows)
      await putArtifact({ runId, kind: 'csv', text: csv })
    }

    const flaggedRows = finalRows.filter((row) => row.needs_review !== '').length
    await updateRun(runId, {
      status: 'done',
      step: 'audit',
      notSafeToImport,
      auditUnavailable,
      flaggedRows,
    })
    await logEvent({
      scope: 'engine', level: notSafeToImport ? 'warn' : 'info', event: 'engine.done', runId,
      detail: { rows: finalRows.length, flaggedRows, notSafeToImport },
    })
    return { status: 'done', runId, csv, flaggedRows, notSafeToImport }
  } catch (error) {
    if (error instanceof ProviderStop) {
      if (error.kind === 'aborted') {
        // Not a stop reason: the artifacts stand and the run resumes.
        await updateRun(runId, { status: 'paused' })
        return { status: 'aborted', runId }
      }
      const run = await getRun(runId)
      await updateRun(runId, {
        status: 'stopped',
        stopReason: error.code ?? error.kind,
        step: (run?.step ?? 'planner') as RunStep,
      })
      await logEvent({ scope: 'engine', level: 'error', event: 'engine.provider_stopped', runId, reason: error.code ?? error.kind })
      return { status: 'provider-stopped', runId, kind: error.kind }
    }
    await logEvent({ scope: 'engine', level: 'error', event: 'engine.exception', runId, reason: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
