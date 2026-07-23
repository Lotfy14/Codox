import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../state/db'
import { getArtifact, getArtifacts } from '../state/runs'
import type { Blueprint, MergedRow } from '../engine/types'
import { groupExamFolders, importAgentBundle } from './import'

const FOLDER = 'folder-test'

/** A File the importer sees exactly as the directory picker delivers it. */
function pickedFile(path: string, body: BlobPart): File {
  const name = path.split('/').pop() ?? path
  const file = new File([body], name)
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

const PAGE_BYTES = new Uint8Array([1, 2, 3])
const FIG_BYTES = new Uint8Array([4, 5, 6, 7])

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    codoxAgentBundle: 1,
    sourceFile: 'Cardio 2024.pdf',
    producedBy: 'test-model',
    pages: [
      { index: 0, file: 'pages/page-001.jpg', width: 1000, height: 1400, role: 'exam' },
    ],
    figures: [
      { id: 'fig-01', file: 'images/fig-01.jpg', page: 1, box: [100, 100, 400, 400] },
    ],
    topics: [{ topic: 'Cardiology', subtopics: ['Arrhythmia'] }],
    questions: [
      {
        id: 'q001',
        question: 'Seen on the film?',
        options: ['Aorta', 'Vena cava'],
        answer: { source: 'extracted', index: 1, evidence: 'answer column' },
        figures: ['fig-01'],
        topic: 'Cardiology',
        subtopic: 'Arrhythmia',
        year: '2024',
        page: 1,
        flag: '',
        groupId: '',
      },
      {
        id: 'q002',
        question: 'Worked out, not read?',
        options: ['Yes', 'No'],
        answer: { source: 'reasoned', index: 0, confidence: 'certain' },
        figures: [],
        topic: 'Cardiology',
        subtopic: '',
        year: '2024',
        page: 1,
        flag: '',
        groupId: '',
      },
    ],
    ...overrides,
  })
}

function bundleFiles(root = 'batch/cardio-2024'): File[] {
  return [
    pickedFile(`${root}/exam.json`, manifest()),
    pickedFile(`${root}/exam.pdf`, new Uint8Array([9, 9])),
    pickedFile(`${root}/pages/page-001.jpg`, PAGE_BYTES),
    pickedFile(`${root}/images/fig-01.jpg`, FIG_BYTES),
    pickedFile(`${root}/NOTES.md`, '# What I did\nRead every page.'),
  ]
}

beforeEach(async () => {
  await db.runs.clear()
  await db.runArtifacts.clear()
  await db.files.clear()
})

describe('groupExamFolders', () => {
  it('finds one exam per exam.json and keeps their files apart', () => {
    const folders = groupExamFolders([
      ...bundleFiles('batch/one'),
      ...bundleFiles('batch/two'),
    ])
    expect(folders.map((folder) => folder.name)).toEqual(['one', 'two'])
    expect([...folders[0].files.keys()].sort()).toEqual([
      'NOTES.md',
      'exam.json',
      'exam.pdf',
      'images/fig-01.jpg',
      'pages/page-001.jpg',
    ])
  })

  it('accepts a single exam folder picked directly', () => {
    const folders = groupExamFolders(bundleFiles('cardio-2024'))
    expect(folders).toHaveLength(1)
    expect(folders[0].files.has('exam.json')).toBe(true)
  })
})

describe('importAgentBundle', () => {
  it('writes a finished run the review and export stack can read', async () => {
    const summary = await importAgentBundle(FOLDER, bundleFiles())

    expect(summary.failures).toEqual([])
    expect(summary.exams).toHaveLength(1)
    const imported = summary.exams[0]
    expect(imported).toMatchObject({
      name: 'cardio-2024',
      questions: 2,
      extracted: 1,
      awaitingApproval: 1,
      flagged: 1,
    })

    const run = await db.runs.get(imported.runId)
    expect(run?.status).toBe('done')
    expect(run?.plannerModel).toBe('agent:test-model')
    expect(run?.yearMode).toBe('ai')
    expect(run?.flaggedRows).toBe(1)

    // The exam shows up in the folder's file list like a converted PDF.
    const stored = await db.files.where('jobId').equals(FOLDER).toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ kind: 'exam', name: 'Cardio 2024.pdf' })
    expect(run?.pdfId).toBe(stored[0].id)
  })

  it('fills correct_index only for the answer the agent saw', async () => {
    const { exams } = await importAgentBundle(FOLDER, bundleFiles())
    const rows = (await getArtifact(exams[0].runId, 'merged-rows'))
      ?.json as MergedRow[]

    expect(rows[0]).toMatchObject({ id: 'q001', correct_index: '1', needs_review: '' })
    // The reasoned answer never reaches the row — NEVER-GUESS holds.
    expect(rows[1]).toMatchObject({
      id: 'q002',
      correct_index: '',
      needs_review: 'no_visible_answer',
    })
  })

  it('parks a reasoned answer in ai-answers for the tutor to approve', async () => {
    const { exams } = await importAgentBundle(FOLDER, bundleFiles())
    const artifact = await getArtifact(exams[0].runId, 'ai-answers')
    const answers = (artifact?.json as { answers?: Record<string, unknown> })
      ?.answers

    expect(answers).toMatchObject({ q002: { index: 0, confidence: 'certain' } })
    // The extracted answer is a real answer, not a suggestion.
    expect(answers?.q001).toBeUndefined()
  })

  it('stores pages and figures so review can show the source', async () => {
    const { exams } = await importAgentBundle(FOLDER, bundleFiles())
    const runId = exams[0].runId

    const pages = await getArtifacts(runId, 'page-jpeg')
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ pageIndex: 0, width: 1000, height: 1400 })
    expect([...(pages[0].bytes ?? [])]).toEqual([...PAGE_BYTES])

    const crops = await getArtifacts(runId, 'crop')
    expect(crops[0]).toMatchObject({ path: 'images/fig-01.jpg', pageIndex: 0 })
    expect([...(crops[0].bytes ?? [])]).toEqual([...FIG_BYTES])

    // The row's image_urls must name the crop path exactly, or the exported
    // bundle's images/ folder will not resolve.
    const rows = (await getArtifact(runId, 'merged-rows'))?.json as MergedRow[]
    expect(rows[0].image_urls).toEqual(['images/fig-01.jpg'])
  })

  it('builds a blueprint with a source region and linked figures per row', async () => {
    const { exams } = await importAgentBundle(FOLDER, bundleFiles())
    const blueprint = (await getArtifact(exams[0].runId, 'blueprint-valid'))
      ?.json as Blueprint

    // No box was declared, so the whole page is the source region.
    expect(blueprint.planned_rows[0].regions.question_prompt).toEqual({
      page: 1,
      box_2d: [0, 0, 1000, 1000],
    })
    expect(blueprint.assets[0]).toMatchObject({
      output_path: 'images/fig-01.jpg',
      page: 1,
      linked_row_ids: ['q001'],
    })
    expect(blueprint.document_profile.question_count).toBe(2)
  })

  it('writes the topic taxonomy and per-row picks so topic columns export', async () => {
    const { exams } = await importAgentBundle(FOLDER, bundleFiles())
    const runId = exams[0].runId

    expect((await getArtifact(runId, 'topics-list'))?.json).toEqual({
      topics: [{ topic: 'Cardiology', subtopics: ['Arrhythmia'] }],
    })
    expect((await getArtifact(runId, 'topic-matches'))?.json).toMatchObject({
      matches: {
        q001: { topic: 'Cardiology', subtopic: 'Arrhythmia' },
        q002: { topic: 'Cardiology', subtopic: '' },
      },
    })
  })

  it("keeps the agent's report", async () => {
    const { exams } = await importAgentBundle(FOLDER, bundleFiles())
    expect((await getArtifact(exams[0].runId, 'agent-report'))?.text).toContain(
      'Read every page.',
    )
  })

  it('reports a broken exam and still imports its neighbours', async () => {
    const broken = [
      pickedFile('batch/broken/exam.json', manifest({ questions: 'nope' })),
      pickedFile('batch/broken/pages/page-001.jpg', PAGE_BYTES),
    ]
    const summary = await importAgentBundle(FOLDER, [
      ...broken,
      ...bundleFiles('batch/good'),
    ])

    expect(summary.exams.map((exam) => exam.name)).toEqual(['good'])
    expect(summary.failures[0].name).toBe('broken')
    expect(summary.failures[0].errors.join('\n')).toContain('questions must be an array')
  })

  it('imports an exam whose agent did not copy the source PDF', async () => {
    const files = bundleFiles().filter(
      (file) => !file.name.endsWith('.pdf'),
    )
    const summary = await importAgentBundle(FOLDER, files)

    expect(summary.failures).toEqual([])
    const stored = await db.files.where('jobId').equals(FOLDER).toArray()
    expect(stored[0]).toMatchObject({ name: 'Cardio 2024.pdf', size: 0 })
  })
})
