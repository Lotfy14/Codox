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
import type { VisionResult } from '../providers/types'
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
import type { AnswerSource, RunArtifact } from '../state/types'
import {
  buildAuditRequest,
  buildPlannerRepairRequest,
  buildPlannerRequest,
  buildWorkerRequest,
  WORKER_MODEL,
  wasTruncated,
  type CallImage,
} from './calls'
import {
  buildReducedBlueprint,
  chunkPages,
  chunkPlannedRows,
  rewriteAssetPaths,
  validateBlueprint,
} from './blueprint'
import { boxToCropBox, hasPositiveExtent } from './boxes'
import { emitCsv } from './csv'
import {
  forceAllRowsBlankFlagged,
  mergeRows,
  policyClaimsEvidence,
  validateWorkerChunk,
} from './merge'
import { resolvePlannerModel } from './models'
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

  constructor(kind: 'wrong-key' | 'provider-error' | 'aborted') {
    super(`provider stop: ${kind}`)
    this.kind = kind
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
): Promise<{ ok: boolean; badPages: number[] }> {
  const existing = await renderedPages(runId)
  if (existing.length > 0) {
    await updateRun(runId, { pagesRendered: existing.length })
    return { ok: true, badPages: [] }
  }

  let renderedCount = 0
  const result = await processPdf(
    pdfBytes,
    async (page) => {
      // Persist as it streams: never hold all pages in JS memory.
      await putArtifact({
        runId,
        kind: 'page-jpeg',
        pageIndex: page.pageIndex,
        width: page.width,
        height: page.height,
        bytes: await blobToBytes(page.jpeg),
      })
      if (page.text !== '') {
        await putArtifact({
          runId,
          kind: 'page-text',
          pageIndex: page.pageIndex,
          text: page.text,
        })
      }
      renderedCount += 1
      await updateRun(runId, {
        pageCount: page.pageCount,
        pagesRendered: renderedCount,
      })
    },
    { dpi: options.dpi, signal: options.signal },
  )

  const badPages = result.failures.map((failure) => failure.pageIndex)
  const rendered = await renderedPages(runId)
  // Zero successfully rendered pages → render_failed. One bad page flags
  // and the run continues.
  return { ok: rendered.length > 0, badPages }
}

// ---------------------------------------------------------------- step 2/3

async function stepPlanAndValidate(
  runId: string,
  controller: GeminiController,
  signal: AbortSignal | undefined,
): Promise<
  | { ok: true; blueprint: Blueprint }
  | { ok: false; reason: 'planner_unparseable' | 'planner_invalid_after_repair' }
> {
  const cached = await getArtifact(runId, 'blueprint-valid')
  if (cached?.json !== undefined) {
    return { ok: true, blueprint: cached.json as Blueprint }
  }

  const pages = await renderedPages(runId)
  const plannerModel = (await resolvePlannerModel(controller, signal)).chosen
  const pageNumbers = pageNumbersOf(pages)
  const images = await pageImages(
    runId,
    pages.map((page) => page.pageIndex ?? 0),
  )

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
    validation = validateBlueprint(repair.text, pageNumbers)
    if (!validation.ok) {
      // Stop BEFORE any worker call.
      return { ok: false, reason: 'planner_invalid_after_repair' }
    }
  }

  // Code owns paths: the crops we produce are JPEG (§1.4, PHASE6 §5).
  const blueprint = rewriteAssetPaths(validation.blueprint)
  await putArtifact({ runId, kind: 'blueprint-valid', json: blueprint })
  return { ok: true, blueprint }
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

// ---------------------------------------------------------------- step 6/7

/**
 * The declaration cross-check (BUILD_PLAN). The user's Upload declaration
 * never feeds a prompt; it is compared with the planner's evidence-based
 * policy AFTER the fact. A contradiction degrades to "everything flagged"
 * — never to wrong rows.
 */
export function declarationContradictsPolicy(
  declared: AnswerSource | undefined,
  blueprint: Blueprint,
): boolean {
  if (declared === undefined) return false
  const policyType = blueprint.document_profile.answer_policy.type
  const policyFoundEvidence = policyClaimsEvidence(policyType)
  // "The answers are in the file" / "in a separate key file" — but the
  // planner found no usable evidence anywhere.
  if (declared !== 'none' && !policyFoundEvidence) return true
  // "There are no answers" — but the planner read answers off the pages.
  if (declared === 'none' && policyFoundEvidence) return true
  return false
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
  declared: AnswerSource | undefined,
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

    let rows: MergedRow[] = merged.rows.map((row) => {
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

    // Declaration cross-check — degrade to everything-flagged, never to
    // wrong rows.
    const wrongDeclaration = declarationContradictsPolicy(declared, blueprint)
    if (wrongDeclaration) {
      rows = forceAllRowsBlankFlagged(rows, 'wrong_declaration')
      await updateRun(runId, { wrongDeclaration: true })
    }
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
        stopReason: error.kind,
        step: (run?.step ?? 'planner') as RunStep,
      })
      return { status: 'provider-stopped', runId, kind: error.kind }
    }
    throw error
  }
}
