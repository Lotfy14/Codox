import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiController } from '../providers/controller'
import { saveGeminiKey } from '../state/credentials'
import { db } from '../state/db'
import { createRun, getArtifacts, getRun } from '../state/runs'
import type { GeminiAdapter, VisionResult } from '../providers/types'
import { executeRun } from './executor'
import {
  makeBlueprint,
  makeEvidenceBlueprint,
  makePlannedRow,
  makeRegion,
} from './fixtures'
import type { Blueprint, WorkerRow } from './types'

/**
 * Drives the whole step machine against a fake adapter and a fake PDF
 * pipeline. Covers: the happy path, every §1.3 stop reason, the planner
 * repair round, the chunk retry, the resume matrix (simulated reload at
 * each step boundary), and quota-pause replay.
 */

// The PDF pipeline is stubbed: pdfium/canvas do not run under happy-dom.
// The executor's contract with it is "call onPage per page"; that is what
// we fake.
const pdfState = {
  pages: 2,
  failPages: [] as number[],
}

vi.mock('../pdf/pipeline', () => ({
  processPdf: async (
    _bytes: Uint8Array,
    onPage: (page: {
      pageIndex: number
      pageCount: number
      width: number
      height: number
      jpeg: Blob
      text: string
    }) => Promise<void>,
  ) => {
    for (let pageIndex = 0; pageIndex < pdfState.pages; pageIndex += 1) {
      if (pdfState.failPages.includes(pageIndex)) continue
      await onPage({
        pageIndex,
        pageCount: pdfState.pages,
        width: 1000,
        height: 2000,
        jpeg: new Blob([`page-${pageIndex}`], { type: 'image/jpeg' }),
        text: `text of page ${pageIndex}`,
      })
    }
    return {
      pageCount: pdfState.pages,
      failures: pdfState.failPages.map((pageIndex) => ({
        pageIndex,
        message: 'render failed',
      })),
    }
  },
}))

vi.mock('../pdf/images', () => ({
  cropJpeg: async (_pageJpeg: Blob) => new Blob(['crop'], { type: 'image/jpeg' }),
  clampCropBox: (box: unknown) => box,
}))

/** A scripted adapter: one queued response per call, in order. */
interface Scripted {
  adapter: GeminiAdapter
  calls: Array<{ prompt: string; modelId?: string; imageCount: number }>
  push(...results: VisionResult[]): void
}

function scriptedAdapter(
  modelIds = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
): Scripted {
  const queue: VisionResult[] = []
  const calls: Scripted['calls'] = []
  return {
    calls,
    push(...results) {
      queue.push(...results)
    },
    adapter: {
      id: 'gemini',
      name: 'Google Gemini',
      async probe() {
        return { ok: true }
      },
      async validateKey() {
        return { ok: true }
      },
      async listModels() {
        return { ok: true, modelIds }
      },
      async complete(request) {
        calls.push({
          prompt: request.prompt,
          modelId: request.modelId,
          imageCount: request.images.length,
        })
        const next = queue.shift()
        if (next === undefined) throw new Error('adapter script exhausted')
        return next
      },
    },
  }
}

function ok(text: string, finishReason = 'STOP'): VisionResult {
  return { ok: true, text, finishReason, usage: { totalTokens: 100 } }
}

function workerResponse(blueprint: Blueprint, fill: Partial<WorkerRow> = {}): string {
  return JSON.stringify({
    rows: blueprint.planned_rows.map((planned) => ({
      id: planned.id,
      group_id: planned.group_id,
      topic: planned.topic,
      subtopic: planned.subtopic,
      year: planned.year,
      question: `Question ${planned.id}?`,
      options: ['A. Alpha', 'B. Beta', 'C. Gamma', 'D. Delta'],
      correct_index: '',
      image_urls: [...planned.image_urls],
      needs_review: '',
      ...fill,
    })),
  })
}

const AUDIT_PASS = JSON.stringify({
  audit_pass: true,
  risk_class: 'safe_to_import',
  failed_rows: [],
  global_failures: [],
  answer_policy_violations: [],
  crop_failures: [],
  notes: [],
})

const PDF_BYTES = new Uint8Array([1, 2, 3])

async function newRun(): Promise<string> {
  return createRun({
    jobId: 'job1',
    pdfId: 'pdf1',
    fileName: 'exam.pdf',
  })
}

beforeEach(async () => {
  pdfState.pages = 2
  pdfState.failPages = []
  await db.runs.clear()
  await db.runArtifacts.clear()
  await db.credentials.clear()
  await saveGeminiKey('local-key')
})

describe('happy path', () => {
  it('runs render → planner → crops → worker → merge → emit → audit and emits the CSV', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)), // planner
      ok(workerResponse(blueprint)), // one chunk (2 rows < 10)
      ok(AUDIT_PASS), // audit
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    if (outcome.status !== 'done') return
    expect(outcome.notSafeToImport).toBe(false)
    // No answer key → every row blank + flagged. That is a success state.
    expect(outcome.flaggedRows).toBe(2)
    expect(outcome.csv).toContain(
      'id,group_id,topic,subtopic,year,question,options,correct_index,image_urls,needs_review',
    )
    expect(outcome.csv).toContain('no_answer_key')
    // Labels were stripped deterministically post-merge.
    expect(outcome.csv).toContain('"[""Alpha"",""Beta"",""Gamma"",""Delta""]"')

    const run = await getRun(runId)
    expect(run?.status).toBe('done')
    expect(run?.step).toBe('audit')
    // Quota burn was counted: planner + worker + audit = 3 requests.
    expect(run?.requestCount).toBe(3)
    expect(run?.totalTokens).toBe(300)
  })

  it('sends the planner all pages and the worker only its chunk pages', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(ok(JSON.stringify(blueprint)), ok(workerResponse(blueprint)), ok(AUDIT_PASS))
    const runId = await newRun()

    await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    const [planner, worker, audit] = script.calls
    expect(planner.imageCount).toBe(2) // all rendered pages
    expect(planner.modelId).toBe('gemini-3.5-flash')
    expect(planner.prompt.startsWith('You are the PLANNER')).toBe(true)
    // Both fixture rows sit on page 1 → the worker gets one page image.
    expect(worker.imageCount).toBe(1)
    expect(worker.modelId).toBe('gemini-3.1-flash-lite')
    expect(worker.prompt.startsWith('You are the WORKER')).toBe(true)
    expect(worker.prompt).toContain('CHUNK PACKAGE:')
    expect(audit.modelId).toBe('gemini-3.1-flash-lite')
    expect(audit.prompt.startsWith('You are the AUDIT model')).toBe(true)
  })

  it('actually renders and sends a separately uploaded answer-key PDF', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(workerResponse(blueprint)),
      ok(AUDIT_PASS),
    )
    const runId = await createRun({
      jobId: 'job1',
      pdfId: 'pdf1',
      answerKeyPdfId: 'key1',
      fileName: 'exam.pdf',
      pageCount: 4,
    })

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
      examPageCount: 2,
      answerKeyBytes: new Uint8Array([9, 8, 7]),
      answerKeyPageCount: 2,
    })

    expect(outcome.status).toBe('done')
    expect(await getArtifacts(runId, 'page-jpeg')).toHaveLength(4)
    expect(await getArtifacts(runId, 'page-text')).toHaveLength(4)
    expect((await getRun(runId))?.pageCount).toBe(4)
    expect(script.calls[0].imageCount).toBe(4)
    expect(script.calls.at(-1)?.imageCount).toBe(4)
  })

  it('keeps the bbox planner on 3.5 even when model listing omits it', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter(['gemini-3.1-flash-lite'])
    script.push(ok(JSON.stringify(blueprint)), ok(workerResponse(blueprint)), ok(AUDIT_PASS))
    const runId = await newRun()

    await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(script.calls.map((call) => call.modelId)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
    ])
    expect((await getRun(runId))?.plannerModel).toBe('gemini-3.5-flash')
    expect(script.calls.map((call) => call.prompt.startsWith('You are the'))).toEqual([
      true,
      true,
      true,
    ])
    expect(script.calls[0].prompt).toContain('PLANNER')
    expect(script.calls[1].prompt).toContain('WORKER')
    expect(script.calls[2].prompt).toContain('AUDIT model')
  })

  it('writes every step artifact to disk', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(ok(JSON.stringify(blueprint)), ok(workerResponse(blueprint)), ok(AUDIT_PASS))
    const runId = await newRun()

    await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(await getArtifacts(runId, 'page-jpeg')).toHaveLength(2)
    expect(await getArtifacts(runId, 'page-text')).toHaveLength(2)
    expect(await getArtifacts(runId, 'blueprint-raw')).toHaveLength(1)
    expect(await getArtifacts(runId, 'blueprint-valid')).toHaveLength(1)
    expect(await getArtifacts(runId, 'chunk-request')).toHaveLength(1)
    expect(await getArtifacts(runId, 'chunk-response')).toHaveLength(1)
    expect(await getArtifacts(runId, 'merged-rows')).toHaveLength(1)
    expect(await getArtifacts(runId, 'csv')).toHaveLength(1)
    expect(await getArtifacts(runId, 'audit-report')).toHaveLength(1)
  })

  it('chunks a long exam into 10-row worker calls', async () => {
    const blueprint = makeBlueprint({
      planned_rows: Array.from({ length: 25 }, (_, i) => makePlannedRow(String(i + 1))),
    })
    blueprint.document_profile.question_count = 25
    const script = scriptedAdapter()
    const chunkOf = (from: number, to: number) =>
      JSON.stringify({
        rows: blueprint.planned_rows.slice(from, to).map((planned) => ({
          ...planned,
          question: `Q${planned.id}`,
          options: ['One', 'Two'],
          correct_index: '',
          needs_review: '',
        })),
      })
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(chunkOf(0, 10)),
      ok(chunkOf(10, 20)),
      ok(chunkOf(20, 25)),
      ok(AUDIT_PASS),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    expect(await getArtifacts(runId, 'chunk-response')).toHaveLength(3)
    if (outcome.status === 'done') {
      expect(outcome.csv.trimEnd().split('\r\n')).toHaveLength(26) // header + 25
    }
  })
})

describe('stop reasons (§1.3)', () => {
  it('render_failed when zero pages render', async () => {
    pdfState.pages = 2
    pdfState.failPages = [0, 1]
    const script = scriptedAdapter()
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'render_failed' })
    expect((await getRun(runId))?.stopReason).toBe('render_failed')
    expect(script.calls).toHaveLength(0) // no model call on a dead document
  })

  it('one bad page flags the run and continues', async () => {
    pdfState.pages = 3
    pdfState.failPages = [1]
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(ok(JSON.stringify(blueprint)), ok(workerResponse(blueprint)), ok(AUDIT_PASS))
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    expect((await getRun(runId))?.badPages).toEqual([1])
    expect(await getArtifacts(runId, 'page-jpeg')).toHaveLength(2)
  })

  it('planner_unparseable on non-JSON, keeping the raw response artifact', async () => {
    const script = scriptedAdapter()
    script.push(ok('I am a helpful assistant and here is some prose.'))
    // The repair round also fails.
    script.push(ok('still prose'))
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    // Unparseable JSON is caught by the blueprint validator → it gets one
    // repair round, then stops before any worker call.
    expect(outcome).toMatchObject({
      status: 'stopped',
      reason: 'planner_invalid_after_repair',
    })
    expect(await getArtifacts(runId, 'blueprint-raw')).toHaveLength(2)
    expect(await getArtifacts(runId, 'chunk-request')).toHaveLength(0)
  })

  it('planner_unparseable on a truncated planner response — no repair round spent', async () => {
    const script = scriptedAdapter()
    script.push(ok('{"csv_schema": [', 'MAX_TOKENS'))
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'planner_unparseable' })
    expect(script.calls).toHaveLength(1)
  })

  it('one repair round fixes an invalid blueprint and the run continues', async () => {
    const broken = makeBlueprint()
    // A content error the repair round may legitimately fix. Deliberately NOT
    // a row shortfall: a planner that emits fewer rows than it counted is
    // under-extraction, which must never be repaired away — see the
    // planner_underextracted tests below.
    broken.planned_rows[0].question_assembly.final_format = 'WRONG'
    const fixed = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(broken)),
      ok(JSON.stringify(fixed)), // the repair
      ok(workerResponse(fixed)),
      ok(AUDIT_PASS),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    // The repair call carried the errors and the invalid blueprint.
    expect(script.calls[1].prompt).toContain('VALIDATION ERRORS:')
    expect(script.calls[1].prompt).toContain('final_format')
    expect(script.calls[1].prompt.startsWith('You are the PLANNER')).toBe(true)
    expect(script.calls[1].modelId).toBe('gemini-3.5-flash') // same planner model
  })

  it('planner_invalid_after_repair stops BEFORE any worker call', async () => {
    const broken = makeBlueprint()
    broken.planned_rows[0].question_assembly.final_format = 'WRONG'
    const script = scriptedAdapter()
    script.push(ok(JSON.stringify(broken)), ok(JSON.stringify(broken)))
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({
      status: 'stopped',
      reason: 'planner_invalid_after_repair',
    })
    expect(script.calls).toHaveLength(2) // planner + exactly one repair
    expect(await getArtifacts(runId, 'chunk-request')).toHaveLength(0)
  })

  // The bug this guards: on a real 30-page, four-exam scan the planner
  // reported question_count 108 and emitted 3 rows. The count rule rejected
  // it, and the repair round "fixed" the mismatch by rewriting the count down
  // to 3 — so a 108-question exam shipped as a green "Done" with 3 rows.
  it('a planner shortfall is NEVER repaired away — it stops the run', async () => {
    const short = makeBlueprint()
    short.document_profile.question_count = 99 // counted 99, emitted 2
    const script = scriptedAdapter()
    script.push(ok(JSON.stringify(short)), ok(JSON.stringify(short)))
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({
      status: 'stopped',
      reason: 'planner_underextracted',
    })
    // No repair round: the shortfall must not even be offered to the model,
    // because the cheapest way for it to comply is to lower the count.
    expect(script.calls).toHaveLength(1)
    expect(await getArtifacts(runId, 'chunk-request')).toHaveLength(0)
  })

  it('a repair may not talk question_count DOWN to match its rows', async () => {
    // Invalid for an unrelated reason, so the repair round legitimately runs…
    const broken = makeBlueprint()
    broken.planned_rows[0].question_assembly.final_format = 'WRONG'
    // …but the repair "fixes" it by dropping a row and lowering the count.
    const lowered = makeBlueprint({
      planned_rows: [makePlannedRow('1')],
    })
    lowered.document_profile.question_count = 1
    const script = scriptedAdapter()
    script.push(ok(JSON.stringify(broken)), ok(JSON.stringify(lowered)))
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({
      status: 'stopped',
      reason: 'planner_underextracted',
    })
    expect(await getArtifacts(runId, 'chunk-request')).toHaveLength(0)
  })

  it('plans a long document in windows, and a straddling question survives exactly once', async () => {
    pdfState.pages = 12 // > one window (10) → two planner calls

    // Window 1 owns pages 1-10 and SEES 1-11 (relative 1..11).
    // Row "2" straddles the boundary: prompt on page 10, options on page 11.
    const window1 = makeBlueprint({
      planned_rows: [
        makePlannedRow('1', {
          regions: {
            case_stem: null,
            question_prompt: makeRegion(1),
            options: makeRegion(1),
            answer_evidence: null,
          },
        }),
        makePlannedRow('2', {
          regions: {
            case_stem: null,
            question_prompt: makeRegion(10), // absolute page 10 — owned here
            options: makeRegion(11), // absolute page 11 — the next window's core
            answer_evidence: null,
          },
        }),
      ],
    })
    window1.document_profile.question_count = 2

    // Window 2 owns pages 11-12 and SEES 10-12 (relative 1=p10, 2=p11, 3=p12).
    // It ALSO plans the straddling question (it can see page 10) — that
    // duplicate must be dropped, because window 2 does not own page 10.
    const window2 = makeBlueprint({
      planned_rows: [
        makePlannedRow('2', {
          regions: {
            case_stem: null,
            question_prompt: makeRegion(1), // absolute page 10 — NOT owned here
            options: makeRegion(2),
            answer_evidence: null,
          },
        }),
        makePlannedRow('3', {
          regions: {
            case_stem: null,
            question_prompt: makeRegion(2), // absolute page 11
            options: makeRegion(2),
            answer_evidence: null,
          },
        }),
        makePlannedRow('4', {
          regions: {
            case_stem: null,
            question_prompt: makeRegion(3), // absolute page 12
            options: makeRegion(3),
            answer_evidence: null,
          },
        }),
      ],
    })
    window2.document_profile.question_count = 3

    // What the stitch should produce: 4 rows, the straddler kept once.
    const stitched = makeBlueprint({
      planned_rows: [
        makePlannedRow('1', { group_id: 'group01' }),
        makePlannedRow('2', { group_id: 'group02' }),
        makePlannedRow('3', { group_id: 'group03' }),
        makePlannedRow('4', { group_id: 'group04' }),
      ],
    })

    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(window1)),
      ok(JSON.stringify(window2)),
      ok(workerResponse(stitched)),
      ok(AUDIT_PASS),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')

    // Two planner calls, each carrying only its own window's pages.
    expect(script.calls[0].imageCount).toBe(11) // pages 1-11 (core + lookahead)
    expect(script.calls[1].imageCount).toBe(3) // pages 10-12 (lookbehind + core)

    const blueprint = (await getArtifacts(runId, 'blueprint-valid'))[0]
      .json as Blueprint
    // The straddler appears once, not twice.
    expect(blueprint.planned_rows).toHaveLength(4)
    expect(blueprint.document_profile.question_count).toBe(4)
    expect(blueprint.planned_rows.map((row) => row.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
    // Absolute page numbers, and the straddler still reaches across into
    // page 11 for its options.
    const straddler = blueprint.planned_rows[1]
    expect(straddler.regions.question_prompt?.page).toBe(10)
    expect(straddler.regions.options?.page).toBe(11)
    // Later windows' pages were offset back to absolute, not left relative.
    expect(
      blueprint.planned_rows.map((row) => row.regions.question_prompt?.page),
    ).toEqual([1, 10, 11, 12])
  })

  it('one chunk retry fixes an invalid chunk and the run continues', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(JSON.stringify({ rows: [] })), // worker dropped both rows
      ok(workerResponse(blueprint)), // the retry is correct
      ok(AUDIT_PASS),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    expect(script.calls[2].prompt).toContain('VALIDATION ERROR:')
    expect(script.calls[2].prompt).toContain('expected 2 rows, got 0')
  })

  it('worker_chunk_invalid after exactly one retry', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(JSON.stringify({ rows: [] })),
      ok(JSON.stringify({ rows: [] })),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({
      status: 'stopped',
      reason: 'worker_chunk_invalid',
    })
    expect(script.calls).toHaveLength(3) // planner + chunk + exactly one retry
  })

  it('audit_unavailable never infers a pass — the run is not safe to import', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(workerResponse(blueprint)),
      { ok: false, kind: 'provider-error', httpStatus: 500 }, // the audit call fails
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done') // the CSV still ships
    if (outcome.status === 'done') expect(outcome.notSafeToImport).toBe(true)
    const run = await getRun(runId)
    expect(run?.auditUnavailable).toBe(true)
    expect(run?.notSafeToImport).toBe(true)
    expect(await getArtifacts(runId, 'csv')).toHaveLength(1)
  })

  it('an audit fail keeps the CSV and the report, marked not safe to import', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(workerResponse(blueprint)),
      ok(
        JSON.stringify({
          audit_pass: false,
          risk_class: 'not_safe_to_import',
          failed_rows: [{ id: '1', field: 'options', reason: 'text mismatch' }],
          global_failures: [],
          answer_policy_violations: [],
          crop_failures: [],
          notes: [],
        }),
      ),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    if (outcome.status === 'done') expect(outcome.notSafeToImport).toBe(true)
    const [report] = await getArtifacts(runId, 'audit-report')
    expect((report.json as { audit_pass: boolean }).audit_pass).toBe(false)
    const run = await getRun(runId)
    expect(run?.auditUnavailable).toBeFalsy()
  })

  it('a wrong key stops the run distinctly — not as a content stop', async () => {
    const script = scriptedAdapter()
    script.push({ ok: false, kind: 'wrong-key', httpStatus: 400 })
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({ status: 'provider-stopped', kind: 'wrong-key' })
    expect((await getRun(runId))?.stopReason).toBe('wrong-key')
  })

  it('persists a safe provider detail so the stopped-run UI is actionable', async () => {
    const script = scriptedAdapter()
    script.push({
      ok: false,
      kind: 'provider-error',
      code: 'invalid-request',
      httpStatus: 400,
    })
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({
      status: 'provider-stopped',
      kind: 'provider-error',
    })
    expect((await getRun(runId))?.stopReason).toBe('invalid-request')
  })

  it('a planner that stays 5xx never silently downgrades bbox detection', async () => {
    const script = scriptedAdapter()
    const overloaded: VisionResult = {
      ok: false,
      kind: 'provider-error',
      code: 'temporarily-unavailable',
      httpStatus: 503,
      retryAfterSeconds: 0,
    }
    // The controller's own transient retries (initial + 3) all fail. The
    // engine stops honestly instead of accepting lower-quality boxes.
    script.push(overloaded, overloaded, overloaded, overloaded)
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({ status: 'provider-stopped', kind: 'provider-error' })
    const plannerModels = script.calls
      .filter((call) => call.prompt.startsWith('You are the PLANNER'))
      .map((call) => call.modelId)
    expect(plannerModels).toEqual([
      'gemini-3.5-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash',
    ])
    expect((await getRun(runId))?.plannerModel).toBe('gemini-3.5-flash')
  })

  it('does not choose flash-lite when only flash-lite appears in model listing', async () => {
    const script = scriptedAdapter(['gemini-3.1-flash-lite'])
    const overloaded: VisionResult = {
      ok: false,
      kind: 'provider-error',
      code: 'temporarily-unavailable',
      httpStatus: 503,
      retryAfterSeconds: 0,
    }
    script.push(overloaded, overloaded, overloaded, overloaded)
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome).toMatchObject({
      status: 'provider-stopped',
      kind: 'provider-error',
    })
    expect((await getRun(runId))?.stopReason).toBe('temporarily-unavailable')
    expect(script.calls.every((call) => call.modelId === 'gemini-3.5-flash')).toBe(true)
    expect(script.calls).toHaveLength(4)
  })
})

describe('quota pause', () => {
  it('a rate-limited call pauses inside the controller and does not consume the chunk retry', async () => {
    const blueprint = makeBlueprint()
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      // The worker call is rate-limited, then succeeds on the controller's
      // own resume — the engine's one retry stays unspent.
      { ok: false, kind: 'rate-limited', retryAfterSeconds: 0, httpStatus: 429 },
      ok(workerResponse(blueprint)),
      ok(AUDIT_PASS),
    )
    const runId = await newRun()
    const controller = new GeminiController(script.adapter)
    const events: string[] = []
    controller.subscribe((event) => events.push(event.type))

    const outcome = await executeRun(runId, PDF_BYTES, { controller })

    expect(outcome.status).toBe('done')
    expect(events).toContain('paused')
    expect(events).toContain('resumed')
    // Only one chunk-response artifact: the paused attempt never produced one.
    expect(await getArtifacts(runId, 'chunk-response')).toHaveLength(1)
  })
})

describe('resume (the checkpoint matrix)', () => {
  /** Runs, then re-enters the executor on the same run id. */
  async function runThenResume(
    firstScript: Scripted,
    secondScript: Scripted,
  ): Promise<{ runId: string; second: Awaited<ReturnType<typeof executeRun>> }> {
    const runId = await newRun()
    await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(firstScript.adapter),
    }).catch(() => undefined)
    const second = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(secondScript.adapter),
    })
    return { runId, second }
  }

  it('resuming after the render step does not re-render or duplicate pages', async () => {
    const blueprint = makeBlueprint()
    const first = scriptedAdapter()
    // The planner call fails hard → the run stops after render.
    first.push({ ok: false, kind: 'provider-error', httpStatus: 500 })
    const second = scriptedAdapter()
    second.push(ok(JSON.stringify(blueprint)), ok(workerResponse(blueprint)), ok(AUDIT_PASS))

    const { runId, second: outcome } = await runThenResume(first, second)

    expect(outcome.status).toBe('done')
    // Pages were rendered once, not twice.
    expect(await getArtifacts(runId, 'page-jpeg')).toHaveLength(2)
  })

  it('resuming after the planner step re-uses the validated blueprint — no second planner call', async () => {
    const blueprint = makeBlueprint()
    const first = scriptedAdapter()
    first.push(
      ok(JSON.stringify(blueprint)),
      { ok: false, kind: 'provider-error', httpStatus: 500 }, // worker dies
    )
    const second = scriptedAdapter()
    second.push(ok(workerResponse(blueprint)), ok(AUDIT_PASS))

    const { runId, second: outcome } = await runThenResume(first, second)

    expect(outcome.status).toBe('done')
    // The resumed run's FIRST call is the worker, not the planner.
    expect(second.calls[0].prompt.startsWith('You are the WORKER')).toBe(true)
    expect(await getArtifacts(runId, 'blueprint-valid')).toHaveLength(1)
  })

  it('resuming mid-worker replays finished chunks and only re-sends the unfinished one', async () => {
    const blueprint = makeBlueprint({
      planned_rows: Array.from({ length: 15 }, (_, i) => makePlannedRow(String(i + 1))),
    })
    blueprint.document_profile.question_count = 15
    const chunkOf = (from: number, to: number) =>
      JSON.stringify({
        rows: blueprint.planned_rows.slice(from, to).map((planned) => ({
          ...planned,
          question: `Q${planned.id}`,
          options: ['One', 'Two'],
          correct_index: '',
          needs_review: '',
        })),
      })

    const first = scriptedAdapter()
    first.push(
      ok(JSON.stringify(blueprint)),
      ok(chunkOf(0, 10)), // chunk 0 lands
      { ok: false, kind: 'provider-error', httpStatus: 500 }, // chunk 1 dies
    )
    const second = scriptedAdapter()
    second.push(ok(chunkOf(10, 15)), ok(AUDIT_PASS))

    const { runId, second: outcome } = await runThenResume(first, second)

    expect(outcome.status).toBe('done')
    // The resumed run re-sent only chunk 1 (then audited): 2 calls.
    expect(second.calls).toHaveLength(2)
    expect(second.calls[0].prompt.startsWith('You are the WORKER')).toBe(true)
    expect(await getArtifacts(runId, 'chunk-response')).toHaveLength(2)
    if (outcome.status === 'done') {
      expect(outcome.csv.trimEnd().split('\r\n')).toHaveLength(16)
    }
  })

  it('an abort pauses the run and keeps its artifacts for a later resume', async () => {
    const blueprint = makeBlueprint()
    const first = scriptedAdapter()
    first.push(ok(JSON.stringify(blueprint)), { ok: false, kind: 'aborted' })
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(first.adapter),
    })

    expect(outcome).toMatchObject({ status: 'aborted' })
    const run = await getRun(runId)
    expect(run?.status).toBe('paused')
    expect(await getArtifacts(runId, 'blueprint-valid')).toHaveLength(1)

    // …and it resumes cleanly from the blueprint.
    const second = scriptedAdapter()
    second.push(ok(workerResponse(blueprint)), ok(AUDIT_PASS))
    const resumed = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(second.adapter),
    })
    expect(resumed.status).toBe('done')
  })
})

describe('evidence-backed answers', () => {
  it('answers the planner grounded in evidence survive to the CSV unflagged', async () => {
    const blueprint = makeEvidenceBlueprint() // policy: inline_marks
    const script = scriptedAdapter()
    script.push(
      ok(JSON.stringify(blueprint)),
      ok(workerResponse(blueprint, { correct_index: '1' })),
      ok(AUDIT_PASS),
    )
    const runId = await newRun()

    const outcome = await executeRun(runId, PDF_BYTES, {
      controller: new GeminiController(script.adapter),
    })

    expect(outcome.status).toBe('done')
    if (outcome.status === 'done') expect(outcome.flaggedRows).toBe(0)
  })
})
