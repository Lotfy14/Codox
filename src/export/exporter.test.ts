import 'fake-indexeddb/auto'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import { createRun, getArtifact, getRun, putArtifact, updateRun } from '../state/runs'
import { saveAiAnswerSettings } from '../state/ai-answers-settings'
import { exportRuns } from './exporter'

/**
 * Drives the real export path (rows → CSV → zip → download) on the web
 * branch, capturing the zip instead of clicking a real download. Verifies
 * the three export modes and that variant exports never mutate the stored
 * engine output.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

let lastZip: Blob | null = null
let lastDownloadName: string | null = null

beforeEach(async () => {
  lastZip = null
  lastDownloadName = null
  URL.createObjectURL = (blob: Blob) => {
    lastZip = blob
    return 'blob:codox-test'
  }
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    lastDownloadName = this.download
  })
  await db.runs.clear()
  await db.runArtifacts.clear()
  await db.meta.clear()
})

function row(id: string, fill: Partial<MergedRow> = {}): MergedRow {
  return {
    id,
    group_id: '',
    topic: 'Surgery',
    subtopic: '',
    year: '',
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correct_index: '',
    image_urls: [],
    needs_review: 'no_answer_key',
    ...fill,
  }
}

async function seedDoneRun(rows: MergedRow[]): Promise<string> {
  const runId = await createRun({
    jobId: 'current',
    pdfId: 'pdf1',
    fileName: 'Exam.pdf',
  })
  await updateRun(runId, { status: 'done' })
  await putArtifact({ runId, kind: 'merged-rows', json: rows })
  return runId
}

async function exportedCsv(): Promise<string> {
  expect(lastZip).not.toBeNull()
  const unzipped = unzipSync(new Uint8Array(await lastZip!.arrayBuffer()))
  const bytes = unzipped['Exam Cx/Exam Cx.csv']
  expect(bytes).toBeDefined()
  // Strip the UTF-8 BOM.
  return new TextDecoder().decode(bytes.subarray(3))
}

describe('export modes', () => {
  it('with-answers (default) keeps document answers and tutor resolutions', async () => {
    const runId = await seedDoneRun([
      row('1', { correct_index: '2', needs_review: '' }),
      row('2'),
    ])
    await putArtifact({ runId, kind: 'review-resolutions', json: { '2': 1 } })
    const run = await getRun(runId)

    const outcome = await exportRuns([run!])

    expect(outcome).toBe('downloaded')
    expect(lastDownloadName).toBe('Exam Cx.zip')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[1]).toContain(',2,') // document answer intact
    expect(lines[2]).toContain(',1,') // the tutor's confirmed answer applied
    expect((await getRun(runId))?.exportedAt).toBeDefined()
  })

  it('no-answers blanks every correct_index — including resolved rows — and keeps flags', async () => {
    const runId = await seedDoneRun([
      row('1', { correct_index: '2', needs_review: '' }),
      row('2'),
      row('3'),
    ])
    await putArtifact({ runId, kind: 'review-resolutions', json: { '2': 1 } })
    const run = await getRun(runId)

    const outcome = await exportRuns([run!], { mode: 'no-answers' })

    expect(outcome).toBe('downloaded')
    expect(lastDownloadName).toBe('Exam Cx (no answers).zip')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[1]).not.toContain(',2,')
    expect(lines[2]).not.toContain(',1,')
    // An unresolved row's flag column still explains its blank answer.
    expect(lines[3]).toContain('no_answer_key')
    // Any successful hand-off counts for the export-early law.
    expect((await getRun(runId))?.exportedAt).toBeDefined()
  })

  it('ai-answers applies the saved AI artifact without touching merged-rows', async () => {
    await saveAiAnswerSettings({ scope: 'unanswered', flagBelow: 'certain' })
    const rows = [row('1', { correct_index: '2', needs_review: '' }), row('2'), row('3')]
    const runId = await seedDoneRun(rows)
    await putArtifact({
      runId,
      kind: 'ai-answers',
      json: {
        answers: {
          '2': { index: 3, confidence: 'certain' },
          '3': { index: 0, confidence: 'unsure' },
        },
        solvedAt: Date.now(),
      },
    })
    const run = await getRun(runId)

    const outcome = await exportRuns([run!], { mode: 'ai-answers' })

    expect(outcome).toBe('downloaded')
    expect(lastDownloadName).toBe('Exam Cx (AI answers).zip')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[1]).toContain(',2,') // document answer untouched
    expect(lines[2]).toContain(',3,') // certain AI answer filled
    expect(lines[2]).toContain('ai_answered')
    expect(lines[3]).not.toContain(',0,') // unsure answer never filled
    expect(lines[3]).toContain('ai_unsure')
    // The stored engine output is pristine: AI answers exist only in the CSV.
    const merged = await getArtifact(runId, 'merged-rows')
    expect(merged?.json).toEqual(rows)
  })

  it('exports nothing when no run is done', async () => {
    const runId = await createRun({
      jobId: 'current',
      pdfId: 'pdf1',
      fileName: 'Exam.pdf',
    })
    const run = await getRun(runId)
    expect(await exportRuns([run!])).toBe('nothing')
    expect(lastZip).toBeNull()
  })
})
