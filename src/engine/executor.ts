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
 * never touch them.
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
  buildBoxRequest, buildEvidenceRequest, buildFigureDetectRequest, buildIndexRequest,
} from './calls'
import { assembleBlueprint } from './assemble'
import { localizeIndexWindow, reconcileIndexWindows, type ReconciledQuestion } from './enumerate'
import { parseBoxResult, parseEvidenceMap, parseFigureDetection, parseIndexWindow, type BoxResult, type EvidenceMap, type IndexWindow } from './index-pass'
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
import { stripEnumerationLabels, stripLeadingQuestionLabel } from './normalize'
import { parseAuditReport, validateFinalRows } from './validate'
import type {
  Blueprint,
  MergedRow,
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
  examPageCount?: number, answerKeyPageCount = 0,
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
  const indexed: IndexWindow[] = []
  const issues: PlanningIssue[] = []
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index]
    const images = await pageImages(runId, window.context.map((page) => page - 1))
    const response = await timed(runId, `index w${index + 1}`, () => call(controller, runId, buildIndexRequest(
      images, window.core.map((page) => window.context.indexOf(page) + 1), PLANNER_MODEL,
    ), signal))
    await putArtifact({ runId, kind: 'index-window', chunkIndex: index, text: response.text })
    const parsed = wasTruncated(response.finishReason) ? undefined : parseIndexWindow(response.text)
    if (parsed === undefined || !parsed.ok) {
    // A checkpoint from the pre-redesign planner is still a valid, safe
    // Blueprint. Accept it without consuming a second call so interrupted
    // older runs and their regression fixtures remain resumable.
    if ((parsed === undefined || !parsed.ok) && windows.length === 1) {
      const legacy = validateBlueprint(response.text, new Set(window.context.map((_page, relative) => relative + 1)))
      if (legacy.ok) {
        await putArtifact({ runId, kind: 'blueprint-raw', text: response.text })
        await putArtifact({ runId, kind: 'blueprint-valid', json: rewriteAssetPaths(legacy.blueprint) })
        return { ok: true, blueprint: rewriteAssetPaths(legacy.blueprint) }
      issues.push(...window.core.map((page) => ({ kind: 'unreadable_page' as const, page })))
      }
    }
      await updateRun(runId, { plannerWindowsDone: index + 1 })
      continue
    }
    indexed.push(localizeIndexWindow(parsed.value, window.context, window.core, index))
    await updateRun(runId, { plannerWindowsDone: index + 1 })
  }
  const reconciled = reconcileIndexWindows(indexed)
  issues.push(...reconciled.issues)
  await logEvent({
    scope: 'engine',
    level: reconciled.questions.length === 0 ? 'error' : 'info',
    event: 'engine.index.reconciled', runId,
    detail: { questions: reconciled.questions.length, issues: reconciled.issues.length },
  })
  if (reconciled.questions.length === 0) {
    // Makes existing interrupted runs and old test fixtures resumable; fresh
    // calls always use INDEX above.
    return stepLegacyPlanAndValidate(runId, controller, signal)
  }

  let evidence: EvidenceMap = {
    type: reconciled.questions.some((row) => row.evidenceState === 'inline') ? 'inline_marks' : 'no_answer_key',
    markingStyle: '', evidence: [],
  }
  if (answerKeyPageCount > 0 && examPageCount !== undefined) {
    const keyPages = allPages.map((page) => (page.pageIndex ?? 0) + 1).filter((page) => page > examPageCount)
    const response = await timed(runId, 'evidence', async () => call(controller, runId, buildEvidenceRequest(
      await pageImages(runId, keyPages.map((page) => page - 1)),
      reconciled.questions.map((row) => ({ ref: row.ref, printedLabel: row.printedLabel, section: row.sectionKey })),
      PLANNER_MODEL,
    ), signal))
    const parsed = wasTruncated(response.finishReason) ? undefined : parseEvidenceMap(response.text)
    if (parsed?.ok) evidence = parsed.value
  }

  // Detection is independent of INDEX's observation, so a false index flag
  // cannot suppress a visual. Its result is checkpointed for diagnostics.
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index]
    const response = await timed(runId, `figure w${index + 1}`, async () => call(controller, runId, buildFigureDetectRequest(
      await pageImages(runId, window.context.map((page) => page - 1)),
      reconciled.questions.filter((row) => window.core.includes(row.ownerPage)).map((row) => ({ ref: row.ref, ownerPage: row.ownerPage })),
      PLANNER_MODEL,
    ), signal))
    await putArtifact({ runId, kind: 'figure-window', chunkIndex: index, text: response.text })
    if (!wasTruncated(response.finishReason)) parseFigureDetection(response.text)
  }

  const allBoxes: BoxResult = { questions: [], figures: [] }
  const byPage = new Map<number, typeof reconciled.questions>()
  for (const question of reconciled.questions) {
    const list = byPage.get(question.ownerPage) ?? []
    list.push(question); byPage.set(question.ownerPage, list)
  }
  const onPage = <T extends { page: number }>(value: T, page: number): T => ({ ...value, page })
  // BOX one page for a set of refs. A ref the model silently omits becomes a
  // blank review card downstream, so a page keeps retrying the refs the last
  // pass dropped (BOX_ATTEMPTS total) before those refs are flagged and left
  // to the whole-page fallback. A full-page failure (truncation/parse error)
  // is retried the same way.
  const BOX_ATTEMPTS = 2
  const boxAttempt = async (page: number, refs: readonly ReconciledQuestion[], attempt: number) => {
    const response = await timed(runId, `box p${page}${attempt > 0 ? ` retry${attempt}` : ''}`, async () => call(controller, runId, buildBoxRequest(
      await pageImages(runId, [page - 1]),
      refs.map((row) => ({
        ref: row.ref,
        printedLabel: row.printedLabel,
        anchor: row.anchor,
        optionsPresent: row.optionsPresent,
        hasCase: row.caseStemKey !== null,
        hasInlineEvidence: row.evidenceState === 'inline'
      })),
      PLANNER_MODEL,
    ), signal))
    const parsed = wasTruncated(response.finishReason) ? undefined : parseBoxResult(response.text)
    return { response, parsed }
  }
  for (const [page, questions] of byPage) {
    let remaining: readonly ReconciledQuestion[] = questions
    let figuresCaptured = false
    let lastReason = 'no box region after retry'
    for (let attempt = 0; attempt < BOX_ATTEMPTS && remaining.length > 0; attempt += 1) {
      const { response, parsed } = await boxAttempt(page, remaining, attempt)
      if (parsed === undefined || !parsed.ok) {
        lastReason = parsed === undefined ? 'BOX response was truncated' : parsed.errors.join('; ')
        await logEvent({ scope: 'engine', level: 'warn', event: 'engine.box.page.fail', runId, page, reason: lastReason, detail: { attempt, rawResponse: response.text } })
        continue
      }
      const wanted = new Set(remaining.map((row) => row.ref))
      const found = parsed.value.questions.filter((row) => wanted.has(row.ref))
      allBoxes.questions.push(...found.map((row) => ({
        ...row, question: onPage(row.question, page), options: row.options === null ? null : onPage(row.options, page),
        caseStem: row.caseStem === null ? null : onPage(row.caseStem, page),
        inlineEvidence: row.inlineEvidence === null ? null : onPage(row.inlineEvidence, page),
      })))
      // Figures cover the whole page, not just the requested refs; capture
      // them once so a retry pass cannot duplicate an asset.
      if (!figuresCaptured) {
        allBoxes.figures.push(...parsed.value.figures.map((row) => ({ ...row, page })))
        figuresCaptured = true
      }
      const foundRefs = new Set(found.map((row) => row.ref))
      remaining = remaining.filter((row) => !foundRefs.has(row.ref))
    }
    if (remaining.length > 0) {
      issues.push(...remaining.map((row) => ({ kind: 'unreadable_page' as const, page, rowRef: row.ref, reason: lastReason })))
    }
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

  const rows: WorkerRow[] = []
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunkRows = chunks[chunkIndex]

    // Resume: a chunk already answered and validated is not re-sent.
    const cached = byChunk.get(chunkIndex)
    if (cached?.text !== undefined) {
      const replay = validateWorkerChunk(cached.text, chunkRows)
      if (replay.ok) {
        rows.push(...replay.rows)
        await updateRun(runId, { chunksDone: chunkIndex + 1 })
        continue
      }
      await clearArtifacts(runId, 'chunk-response')
    }

    const reduced = buildReducedBlueprint(blueprint, chunkRows)
    const pages = chunkPages(reduced).map((page) => page - 1)
    const cropPaths = reduced.assets.map((asset) => asset.output_path)
    const images = [
      ...(await pageImages(runId, pages)),
      ...(await cropImages(runId, cropPaths)),
    ]

    await putArtifact({
      runId,
      kind: 'chunk-request',
      chunkIndex,
      json: { reduced, pages, cropPaths, workerModel },
    })

    let previousError: string | undefined
    let accepted: WorkerRow[] | undefined
    // Exactly one retry, consumed only by INVALID CONTENT.
    for (let attempt = 0; attempt < 2 && accepted === undefined; attempt += 1) {
      const response = await timed(
        runId,
        `worker chunk ${chunkIndex + 1}`,
        () =>
          call(
            controller,
            runId,
            buildWorkerRequest(reduced, images, workerModel, previousError),
            signal,
          ),
      )
      await putArtifact({
        runId,
        kind: 'chunk-response',
        chunkIndex,
        text: response.text,
      })
      if (wasTruncated(response.finishReason)) {
        previousError = 'your response was truncated; return fewer characters'
        continue
      }
      const validation = validateWorkerChunk(response.text, chunkRows)
      if (validation.ok) {
        accepted = validation.rows
      } else {
        previousError = validation.errors.join('; ')
      }
    }

    if (accepted === undefined) return { ok: false }
    rows.push(...accepted)
    await updateRun(runId, { chunksDone: chunkIndex + 1 })
  }

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

    const rows: MergedRow[] = merged.rows.map((row) => {
      const normalized = stripEnumerationLabels(row.options)
      // Drop the printed question number the worker transcribed verbatim
      // ("18– A 49yo…" → "A 49yo…"); shape-based, not label-matched.
      const question = stripLeadingQuestionLabel(row.question)
      // A row whose prompt read back empty is flagged, never a silent blank
      // card: BOX failed on that page and the whole-page fallback yielded no
      // text. NEVER-GUESS — a flag pointing at the page beats an empty row.
      const emptyQuestion = question.trim() === ''
      return {
        ...row,
        question,
        options: normalized.options,
        // An existing flag wins; otherwise flag empties, then ambiguous labels.
        needs_review:
          row.needs_review !== ''
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
    const csv = await timed(runId, 'emit', async () => {
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

    const flaggedRows = rows.filter((row) => row.needs_review !== '').length
    await updateRun(runId, {
      status: 'done',
      step: 'audit',
      notSafeToImport,
      auditUnavailable,
      flaggedRows,
    })
    await logEvent({
      scope: 'engine', level: notSafeToImport ? 'warn' : 'info', event: 'engine.done', runId,
      detail: { rows: rows.length, flaggedRows, notSafeToImport },
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
