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
import { stripEnumerationLabels } from './normalize'
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

async function stop(runId: string, step: RunStep, reason: StopReason): Promise<RunOutcome> {
  await updateRun(runId, { status: 'stopped', step, stopReason: reason })
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
async function stepPlanAndValidate(
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
  // Bounding-box quality is a correctness requirement. Never silently
  // downgrade this role to Flash Lite because a model-list request failed.
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
      const response = await call(
        controller,
        runId,
        buildWorkerRequest(reduced, images, workerModel, previousError),
        signal,
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
    await updateRun(runId, { step: 'render' })
    const render = await stepRender(runId, pdfBytes, options)
    if (!render.ok) return stop(runId, 'render', 'render_failed')
    if (render.badPages.length > 0) {
      await updateRun(runId, { badPages: render.badPages })
    }

    // 2/3 — planner + blueprint validation (one repair round)
    await updateRun(runId, { step: 'planner' })
    const planned = await stepPlanAndValidate(runId, controller, signal)
    if (!planned.ok) return stop(runId, 'planner', planned.reason)
    const blueprint = planned.blueprint

    // 4 — deterministic crops
    await updateRun(runId, { step: 'crops' })
    const { producedCrops, cropFailures } = await stepCrops(runId, blueprint)
    let notSafeToImport = cropFailures.length > 0

    // 5 — chunked worker calls
    await updateRun(runId, { step: 'worker' })
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
    await updateRun(runId, { step: 'merge' })
    const merged = mergeRows(blueprint, worker.rows)
    if (!merged.ok) return stop(runId, 'merge', 'merge_validation_failed')

    const rows: MergedRow[] = merged.rows.map((row) => {
      const normalized = stripEnumerationLabels(row.options)
      return {
        ...row,
        options: normalized.options,
        // An ambiguous label set is flagged, never guessed at.
        needs_review:
          normalized.ambiguous && row.needs_review === ''
            ? 'possible_merge'
            : row.needs_review,
      }
    })

    await putArtifact({ runId, kind: 'merged-rows', json: rows })

    // 7 — final validation + CSV emit. A failure still writes the CSV.
    await updateRun(runId, { step: 'emit' })
    const final = validateFinalRows(rows, blueprint, producedCrops)
    if (!final.ok) notSafeToImport = true
    const csv = emitCsv(rows)
    await putArtifact({ runId, kind: 'csv', text: csv })

    // 8 — the read-only audit gate
    await updateRun(runId, { step: 'audit' })
    let auditUnavailable = false
    try {
      const auditImages = [
        ...(await pageImages(
          runId,
          (await renderedPages(runId)).map((page) => page.pageIndex ?? 0),
        )),
        ...(await cropImages(runId, [...producedCrops])),
      ]
      const audit = await call(
        controller,
        runId,
        buildAuditRequest(blueprint, rows, auditImages),
        signal,
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

    const flaggedRows = rows.filter((row) => row.needs_review !== '').length
    await updateRun(runId, {
      status: 'done',
      step: 'audit',
      notSafeToImport,
      auditUnavailable,
      flaggedRows,
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
      return { status: 'provider-stopped', runId, kind: error.kind }
    }
    throw error
  }
}
