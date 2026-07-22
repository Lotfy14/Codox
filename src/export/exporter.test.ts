import 'fake-indexeddb/auto'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import { createRun, getArtifact, getRun, putArtifact, updateRun } from '../state/runs'
import { countUnexportedFlagged, exportRuns } from './exporter'

/**
 * Drives the real export path (rows → CSV → zip → download) on the web
 * branch, capturing the zip instead of clicking a real download. The
 * export always carries the rows exactly as they stand in review and
 * never mutates the stored engine output.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({
    saveToDownloads: () => Promise.resolve(),
  }),
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

/**
 * A resolved row by default (answered, unflagged) — only resolved rows
 * export now (owner-approved 2026-07-21), so the projection/edit tests below
 * start from an exportable row and the exclusion tests opt into a blank one.
 */
function row(id: string, fill: Partial<MergedRow> = {}): MergedRow {
  return {
    id,
    group_id: '',
    topic: 'Surgery',
    subtopic: '',
    year: '',
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correct_index: '0',
    image_urls: [],
    needs_review: '',
    ...fill,
  }
}

/** An unresolved row: no confirmed answer, still flagged for review. */
function blankRow(id: string, fill: Partial<MergedRow> = {}): MergedRow {
  return row(id, { correct_index: '', needs_review: 'no_answer_key', ...fill })
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

const BASE_HEADER = 'question,options,correct_index,image_url'

describe('export', () => {
  it('keeps document answers and tutor resolutions', async () => {
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
    // The projected header: no id/group_id, no unprovided optional columns.
    expect(lines[0]).toBe(BASE_HEADER)
    expect(lines[1]).toContain(',2,') // document answer intact
    expect(lines[2]).toContain(',1,') // the tutor's confirmed answer applied
    expect((await getRun(runId))?.exportedAt).toBeDefined()
  })

  it('a saved AI artifact never leaks into the export by itself', async () => {
    // AI answers reach the CSV only after the tutor approves them in review
    // (they become ordinary resolutions); the cached artifact alone is inert.
    // The blank row is held back entirely — an unapproved AI answer can never
    // fill it, so it neither ships nor gets guessed.
    const rows = [row('1', { correct_index: '2' }), blankRow('2')]
    const runId = await seedDoneRun(rows)
    await putArtifact({
      runId,
      kind: 'ai-answers',
      json: {
        answers: { '2': { index: 3, confidence: 'certain' } },
        solvedAt: Date.now(),
      },
    })
    const run = await getRun(runId)

    expect(await exportRuns([run!])).toBe('downloaded')
    const csv = await exportedCsv()
    expect(csv).toContain(',2,') // document answer intact
    expect(csv).not.toContain('Question 2?') // blank row held back
    expect(csv).not.toContain(',3,') // unapproved AI answer stays out
    expect(await getArtifact(runId, 'merged-rows').then((a) => a?.json)).toEqual(rows)
  })

  it('holds back rows that still need review; resolved rows still ship', async () => {
    const runId = await seedDoneRun([
      row('1', { correct_index: '2' }), // document answer → ships
      blankRow('2'), // no answer, still flagged → held back
      blankRow('3', { needs_review: 'not_mcq', options: [] }), // structural flag → held back
    ])
    // The tutor confirms row 2 in review; row 3 stays unresolved.
    await putArtifact({ runId, kind: 'review-resolutions', json: { '2': 1 } })
    const run = await getRun(runId)

    expect(await exportRuns([run!])).toBe('downloaded')
    const csv = await exportedCsv()
    expect(csv).toContain('Question 1?')
    expect(csv).toContain('Question 2?') // resolved in review → ships
    expect(csv).not.toContain('Question 3?') // still flagged → held back
  })

  it('countUnexportedFlagged counts only the still-unresolved rows', async () => {
    const runId = await seedDoneRun([
      row('1', { correct_index: '2' }),
      blankRow('2'),
      blankRow('3'),
    ])
    await putArtifact({ runId, kind: 'review-resolutions', json: { '2': 1 } })
    const run = await getRun(runId)

    // Row 1 answered, row 2 resolved in review, row 3 still blank → 1 held back.
    expect(await countUnexportedFlagged([run!])).toBe(1)
  })

  it('a run with nothing resolved exports an empty bundle (no answer key)', async () => {
    const runId = await seedDoneRun([blankRow('1'), blankRow('2')])
    const run = await getRun(runId)

    expect(await countUnexportedFlagged([run!])).toBe(2)
    expect(await exportRuns([run!])).toBe('downloaded')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    // Header only — every question was held back for review.
    expect(lines).toEqual([BASE_HEADER])
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

describe('column projection', () => {
  it('a topics run gains topic/subtopic columns; gaps stay blank; merged-rows pristine', async () => {
    const rows = [row('1'), row('2')]
    const runId = await seedDoneRun(rows)
    await putArtifact({
      runId,
      kind: 'topics-list',
      json: { topics: [{ topic: 'Anatomy', subtopics: ['Abdomen'] }] },
    })
    // Partial matching: only row 1 has a cached match.
    await putArtifact({
      runId,
      kind: 'topic-matches',
      json: {
        matches: { '1': { topic: 'Anatomy', subtopic: 'Abdomen' } },
        matchedAt: Date.now(),
      },
    })
    const run = await getRun(runId)

    expect(await exportRuns([run!])).toBe('downloaded')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[0]).toBe(`topic,subtopic,${BASE_HEADER}`)
    expect(lines[1].startsWith('Anatomy,Abdomen,Question 1?')).toBe(true)
    // Unmatched row: blank cells, never the planner's heading text.
    expect(lines[2].startsWith(',,Question 2?')).toBe(true)
    expect(await getArtifact(runId, 'merged-rows').then((a) => a?.json)).toEqual(rows)
  })

  it('typed year stamps every row; document year passes through on ai mode', async () => {
    const typedId = await seedDoneRun([row('1', { year: '1999' })])
    await updateRun(typedId, { yearMode: 'type', typedYear: '2024' })
    expect(await exportRuns([(await getRun(typedId))!])).toBe('downloaded')
    let lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[0]).toBe(`year,${BASE_HEADER}`)
    expect(lines[1].startsWith('2024,Question 1?')).toBe(true)

    await db.runs.clear()
    await db.runArtifacts.clear()
    const aiId = await seedDoneRun([row('1', { year: '1999' }), row('2')])
    await updateRun(aiId, { yearMode: 'ai' })
    expect(await exportRuns([(await getRun(aiId))!])).toBe('downloaded')
    lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[0]).toBe(`year,${BASE_HEADER}`)
    expect(lines[1].startsWith('1999,')).toBe(true)
    // No document evidence → honestly blank, never guessed.
    expect(lines[2].startsWith(',Question 2?')).toBe(true)
  })

  it('type mode with an empty year adds no column', async () => {
    const runId = await seedDoneRun([row('1')])
    await updateRun(runId, { yearMode: 'type', typedYear: '' })
    expect(await exportRuns([(await getRun(runId))!])).toBe('downloaded')
    expect((await exportedCsv()).split('\r\n')[0]).toBe(BASE_HEADER)
  })

  it('pre-feature runs (no snapshot) export the base four columns', async () => {
    const runId = await seedDoneRun([row('1', { topic: 'Heading', year: '2001' })])
    expect(await exportRuns([(await getRun(runId))!])).toBe('downloaded')
    const csv = await exportedCsv()
    expect(csv.split('\r\n')[0]).toBe(BASE_HEADER)
    // Planner heading/year values never leak without the columns.
    expect(csv).not.toContain('Heading')
    expect(csv).not.toContain('2001')
  })
})

describe('figure crops at export', () => {
  async function zipFile(path: string): Promise<Uint8Array | undefined> {
    expect(lastZip).not.toBeNull()
    return unzipSync(new Uint8Array(await lastZip!.arrayBuffer()))[path]
  }

  it('ships the stored crop bytes when the tutor made no adjustment', async () => {
    const runId = await seedDoneRun([row('1')])
    const bytes = new Uint8Array([1, 2, 3, 4])
    await putArtifact({
      runId,
      kind: 'crop',
      pageIndex: 0,
      path: 'images/asset01.jpg',
      bytes,
    })
    expect(await exportRuns([(await getRun(runId))!])).toBe('downloaded')
    expect(await zipFile('Exam Cx/images/asset01.jpg')).toEqual(bytes)
  })

  it('falls back to the stored crop when an override has no source page', async () => {
    // An override is set but the source page artifact is gone: the export
    // never drops the figure — it ships the crop the engine already stored.
    const runId = await seedDoneRun([row('1')])
    const bytes = new Uint8Array([9, 8, 7, 6])
    await putArtifact({
      runId,
      kind: 'crop',
      pageIndex: 0,
      path: 'images/asset01.jpg',
      bytes,
    })
    await putArtifact({
      runId,
      kind: 'review-figure-crops',
      json: { 'images/asset01.jpg': [0, 0, 1000, 1000] },
    })
    expect(await exportRuns([(await getRun(runId))!])).toBe('downloaded')
    expect(await zipFile('Exam Cx/images/asset01.jpg')).toEqual(bytes)
  })
})

describe('review edits at export', () => {
  it('content edits reach the CSV; merged-rows stays pristine', async () => {
    const rows = [row('1', { correct_index: '2', needs_review: '' }), row('2')]
    const runId = await seedDoneRun(rows)
    // Row 1: option 0 removed — the extracted answer follows its option.
    await putArtifact({
      runId,
      kind: 'review-edits',
      json: {
        '1': {
          question: 'Rewritten question 1?',
          options: ['Beta', 'Gamma', 'Delta'],
          correctIndex: '1',
        },
      },
    })
    const run = await getRun(runId)

    expect(await exportRuns([run!])).toBe('downloaded')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[1].startsWith('Rewritten question 1?,')).toBe(true)
    expect(lines[1]).not.toContain('Alpha')
    expect(lines[1]).toContain(',1,')
    expect(lines[2].startsWith('Question 2?,')).toBe(true)
    expect(await getArtifact(runId, 'merged-rows').then((a) => a?.json)).toEqual(rows)
  })

  it('an edited topic or year forces its column and beats the matcher', async () => {
    const runId = await seedDoneRun([
      row('1', { topic: 'Heading', year: '2001' }),
      row('2'),
    ])
    // No topics list, yearMode off — the columns exist only via the edit.
    await putArtifact({
      runId,
      kind: 'review-edits',
      json: { '2': { topic: 'Surgery', subtopic: 'Hernia', year: '2023' } },
    })
    const run = await getRun(runId)

    expect(await exportRuns([run!])).toBe('downloaded')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[0]).toBe(`topic,subtopic,year,${BASE_HEADER}`)
    // The unedited row stays blank — planner heading text never leaks.
    expect(lines[1].startsWith(',,,Question 1?')).toBe(true)
    expect(lines[2].startsWith('Surgery,Hernia,2023,Question 2?')).toBe(true)
  })

  it('resolutions validate against the edited options', async () => {
    const runId = await seedDoneRun([row('1')])
    await putArtifact({
      runId,
      kind: 'review-edits',
      json: { '1': { options: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'] } },
    })
    // Index 4 only exists in the edited list — it must be honored.
    await putArtifact({ runId, kind: 'review-resolutions', json: { '1': 4 } })
    const run = await getRun(runId)

    expect(await exportRuns([run!])).toBe('downloaded')
    const lines = (await exportedCsv()).trimEnd().split('\r\n')
    expect(lines[1]).toContain('Epsilon')
    expect(lines[1]).toContain(',4,')
  })
})
