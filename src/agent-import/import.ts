/**
 * Agent-bundle import: turn a folder an agent produced into exactly what a
 * finished conversion leaves behind — a `done` run plus its artifacts — so
 * Review, edit mode, topic matching, and export all work on it unchanged.
 *
 * This is new surface OUTSIDE the engine path, solver-style. It makes no
 * network request of any kind (no Gemini call, no key), never touches the
 * three pinned prompts or the output contract, and honours NEVER-GUESS
 * through the manifest's declared answer source: an `extracted` answer (one
 * the agent SAW on the page) fills `correct_index` like the worker's does; a
 * `reasoned` one lands in `ai-answers`, leaving the row blank and flagged
 * until the tutor approves it in Review.
 */
import { assetJpegPath } from '../engine/blueprint'
import type { AiAnswer, AiAnswersArtifact } from '../engine/solver'
import type { TopicMatch, TopicMatchesArtifact } from '../engine/topic-matcher'
import {
  CSV_SCHEMA,
  type Blueprint,
  type BlueprintAsset,
  type Box2d,
  type MergedRow,
  type PlannedRow,
} from '../engine/types'
import { addStoredPdf } from '../state/files'
import { createRun, putArtifact, updateRun } from '../state/runs'
import type { YearMode } from '../state/types'
import {
  EXAM_MANIFEST_NAME,
  NOTES_NAME,
  normalizeBundlePath,
  validateAgentExam,
  type AgentExam,
  type AgentQuestion,
} from './manifest.ts'

/** The whole-page region a question with no declared box falls back to. */
const WHOLE_PAGE: Box2d = [0, 0, 1000, 1000]

export interface ImportedExam {
  /** The exam's folder name in the bundle — what the tutor recognises. */
  name: string
  runId: string
  questions: number
  /** Answers the agent read off the document; these ship. */
  extracted: number
  /** Reasoned answers waiting for the tutor's approval in Review. */
  awaitingApproval: number
  /** Rows still flagged (no confirmed answer, or a structural problem). */
  flagged: number
  warnings: string[]
  /** The agent's own NOTES.md, when it wrote one. */
  report?: string
}

export interface ImportFailure {
  name: string
  errors: string[]
}

export interface ImportSummary {
  exams: ImportedExam[]
  failures: ImportFailure[]
}

export interface ImportOptions {
  onProgress?: (done: number, total: number, name: string) => void
  signal?: AbortSignal
}

/** True when this browser can hand us a directory at all (feature, not OS). */
export function canPickDirectory(): boolean {
  return (
    typeof HTMLInputElement !== 'undefined' &&
    'webkitdirectory' in HTMLInputElement.prototype
  )
}

/** The path a picked file sits at, relative to the directory that was picked. */
function pickedPath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath
  return normalizeBundlePath(
    relative !== undefined && relative !== '' ? relative : file.name,
  )
}

interface ExamFolder {
  /** Directory name shown to the tutor. */
  name: string
  /** Bundle-relative path → File, for everything under this exam. */
  files: Map<string, File>
}

/**
 * Group a flat picked file list into exam folders: every directory holding an
 * `exam.json` is one exam. Locating exams by their manifest (rather than by
 * depth) means the tutor may pick the whole batch folder or a single exam's
 * folder and both work.
 */
export function groupExamFolders(files: readonly File[]): ExamFolder[] {
  const paths = new Map<string, File>()
  for (const file of files) paths.set(pickedPath(file), file)

  const roots: string[] = []
  for (const path of paths.keys()) {
    if (path === EXAM_MANIFEST_NAME) roots.push('')
    else if (path.endsWith(`/${EXAM_MANIFEST_NAME}`)) {
      roots.push(path.slice(0, -(EXAM_MANIFEST_NAME.length + 1)))
    }
  }
  roots.sort()

  return roots.map((root) => {
    const prefix = root === '' ? '' : `${root}/`
    const owned = new Map<string, File>()
    for (const [path, file] of paths) {
      if (!path.startsWith(prefix)) continue
      const relative = path.slice(prefix.length)
      // A nested exam belongs to its own folder, never to its parent.
      if (relative.includes(`/${EXAM_MANIFEST_NAME}`)) continue
      owned.set(relative, file)
    }
    const segments = root.split('/').filter((part) => part !== '')
    return {
      name: segments[segments.length - 1] ?? 'Imported exam',
      files: owned,
    }
  })
}

/**
 * Imports every exam in a picked folder into `folderId`. One bad exam is
 * reported and skipped — it never stops the others, the same way one bad page
 * never crashes a run.
 */
export async function importAgentBundle(
  folderId: string,
  files: readonly File[],
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const folders = groupExamFolders(files)
  const summary: ImportSummary = { exams: [], failures: [] }
  let done = 0
  for (const folder of folders) {
    if (options.signal?.aborted) break
    options.onProgress?.(done, folders.length, folder.name)
    try {
      const imported = await importOneExam(folderId, folder)
      if ('errors' in imported) summary.failures.push(imported)
      else summary.exams.push(imported)
    } catch (error) {
      summary.failures.push({
        name: folder.name,
        errors: [error instanceof Error ? error.message : String(error)],
      })
    }
    done += 1
    options.onProgress?.(done, folders.length, folder.name)
  }
  return summary
}

async function importOneExam(
  folderId: string,
  folder: ExamFolder,
): Promise<ImportedExam | ImportFailure> {
  const manifestFile = folder.files.get(EXAM_MANIFEST_NAME)
  if (manifestFile === undefined) {
    return { name: folder.name, errors: [`no ${EXAM_MANIFEST_NAME}`] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await manifestFile.text())
  } catch (error) {
    return {
      name: folder.name,
      errors: [
        `${EXAM_MANIFEST_NAME} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    }
  }
  const validation = validateAgentExam(parsed, new Set(folder.files.keys()))
  if (!validation.ok) return { name: folder.name, errors: validation.errors }
  const exam = validation.exam

  // ------------------------------------------------------------ the exam PDF
  // Stored so the imported exam appears in the folder's file list exactly
  // like a converted one. An agent that did not copy the PDF still imports —
  // the row simply has no bytes behind it, and nothing offers to convert it.
  const sourcePdf = folder.files.get('exam.pdf')
  const fileName =
    exam.sourceFile.trim() !== '' ? exam.sourceFile.trim() : `${folder.name}.pdf`
  const examPages = exam.pages.filter((page) => page.role === 'exam').length
  const pdfId = await addStoredPdf({
    jobId: folderId,
    kind: 'exam',
    name: fileName,
    size: sourcePdf?.size ?? 0,
    pageCount: examPages === 0 ? exam.pages.length : examPages,
    blob: sourcePdf ?? new Blob([], { type: 'application/pdf' }),
  })

  const figurePaths = figurePathsById(exam)
  const rows = exam.questions.map((question) => toMergedRow(question, figurePaths))
  const yearMode: YearMode = rows.some((row) => row.year !== '') ? 'ai' : 'off'
  const runId = await createRun({
    jobId: folderId,
    pdfId,
    fileName,
    status: 'done',
    step: 'audit',
    pageCount: exam.pages.length,
    pagesRendered: exam.pages.length,
    plannerModel:
      exam.producedBy.trim() === '' ? 'agent' : `agent:${exam.producedBy.trim()}`,
    yearMode,
  })

  // --------------------------------------------------------------- artifacts
  // Pages one at a time: read, store, release. A 40-page bundle must never
  // sit in JS memory all at once (the ~100 MB working-set discipline).
  for (const page of exam.pages) {
    const file = folder.files.get(page.file)
    if (file === undefined) continue
    await putArtifact({
      runId,
      kind: 'page-jpeg',
      pageIndex: page.index,
      width: page.width,
      height: page.height,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
  }

  for (const figure of exam.figures) {
    const file = folder.files.get(figure.file)
    if (file === undefined) continue
    await putArtifact({
      runId,
      kind: 'crop',
      pageIndex: figure.page - 1,
      path: assetJpegPath(figure.file),
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
  }

  await putArtifact({
    runId,
    kind: 'blueprint-valid',
    json: buildBlueprint(exam),
  })
  await putArtifact({ runId, kind: 'merged-rows', json: rows })

  const aiAnswers = buildAiAnswers(exam.questions)
  if (Object.keys(aiAnswers).length > 0) {
    await putArtifact({
      runId,
      kind: 'ai-answers',
      json: { answers: aiAnswers, solvedAt: Date.now() } satisfies AiAnswersArtifact,
    })
  }

  // Topic columns key off the `topics-list` artifact, so write the taxonomy
  // whenever the agent supplied one — with it the run's per-row picks export
  // and `RunTopicsPanel` can edit and re-match them later.
  if (exam.topics.length > 0) {
    await putArtifact({ runId, kind: 'topics-list', json: { topics: exam.topics } })
    const matches: Record<string, TopicMatch> = {}
    for (const question of exam.questions) {
      matches[question.id] = {
        topic: question.topic,
        subtopic: question.subtopic,
      }
    }
    await putArtifact({
      runId,
      kind: 'topic-matches',
      json: { matches, matchedAt: Date.now() } satisfies TopicMatchesArtifact,
    })
  }

  const notesFile = folder.files.get(NOTES_NAME)
  const report = notesFile === undefined ? undefined : await notesFile.text()
  if (report !== undefined) {
    await putArtifact({ runId, kind: 'agent-report', text: report })
  }

  const flagged = rows.filter(
    (row) => row.correct_index === '' || row.needs_review !== '',
  ).length
  await updateRun(runId, { flaggedRows: flagged })

  return {
    name: folder.name,
    runId,
    questions: rows.length,
    extracted: rows.filter((row) => row.correct_index !== '').length,
    awaitingApproval: Object.keys(aiAnswers).length,
    flagged,
    warnings: validation.warnings,
    report,
  }
}

// ------------------------------------------------------------------ mapping

/**
 * figure id → the bundle path its bytes are stored under. Code owns the path
 * (§1.4): `assetJpegPath` is the same rewrite the engine applies, so a row's
 * `image_urls`, its blueprint asset, and its `crop` artifact always agree —
 * which is what makes the exported bundle's `images/` folder resolve.
 */
export function figurePathsById(exam: AgentExam): Map<string, string> {
  return new Map(
    exam.figures.map((figure) => [figure.id, assetJpegPath(figure.file)]),
  )
}

/**
 * One manifest question → one final row. The answer only survives as a
 * `correct_index` when the agent declared it `extracted`; everything else
 * ships blank with a reason from merge's existing vocabulary, so Review's
 * `flagCategory` explains it to the tutor in the usual words.
 */
export function toMergedRow(
  question: AgentQuestion,
  figurePaths: ReadonlyMap<string, string>,
): MergedRow {
  const extracted =
    question.answer.source === 'extracted' && question.answer.index !== null
  const correctIndex = extracted ? String(question.answer.index) : ''
  const needsReview =
    question.flag !== ''
      ? question.flag
      : correctIndex === ''
        ? 'no_visible_answer'
        : ''
  return {
    id: question.id,
    group_id: question.groupId,
    topic: question.topic,
    subtopic: question.subtopic,
    year: question.year,
    question: question.question,
    options: [...question.options],
    correct_index: correctIndex,
    image_urls: question.figures.flatMap((id) => {
      const path = figurePaths.get(id)
      return path === undefined ? [] : [path]
    }),
    needs_review: needsReview,
  }
}

function buildAiAnswers(
  questions: readonly AgentQuestion[],
): Record<string, AiAnswer> {
  const answers: Record<string, AiAnswer> = {}
  for (const question of questions) {
    if (question.answer.source !== 'reasoned' || question.answer.index === null) {
      continue
    }
    answers[question.id] = {
      index: question.answer.index,
      confidence: question.answer.confidence ?? 'likely',
    }
  }
  return answers
}

/**
 * The blueprint Review reads: a source region per row (the declared box, or
 * the whole page when the agent gave none) and one asset per figure, so
 * `loadReviewData` finds both the question crop and the linked pictures.
 */
export function buildBlueprint(exam: AgentExam): Blueprint {
  const pathById = figurePathsById(exam)
  const assets: BlueprintAsset[] = exam.figures.map((figure) => ({
    asset_id: figure.id,
    kind: 'figure',
    page: figure.page,
    box_2d: figure.box,
    output_path: assetJpegPath(figure.file),
    linked_group_id: '',
    linked_row_ids: exam.questions
      .filter((question) => question.figures.includes(figure.id))
      .map((question) => question.id),
    anchor: '',
  }))

  const plannedRows: PlannedRow[] = exam.questions.map((question) => ({
    id: question.id,
    group_id: question.groupId,
    topic: question.topic,
    subtopic: question.subtopic,
    year: question.year,
    question_assembly: {
      mode: 'plain_question_prompt',
      final_format: '{question_prompt}',
    },
    regions: {
      case_stem: null,
      question_prompt: { page: question.page, box_2d: question.box ?? WHOLE_PAGE },
      options: null,
      answer_evidence: null,
    },
    image_urls: question.figures.flatMap((id) => {
      const path = pathById.get(id)
      return path === undefined ? [] : [path]
    }),
    correct_index_policy: { type: 'agent', value: '', needs_review: '' },
    worker_task: {
      case_stem_required: false,
      read_regions_only: true,
      must_follow_planner_structure: true,
    },
    source_pages: [question.page],
  }))

  const hasKeyPages = exam.pages.some((page) => page.role === 'answer-key')
  const anyExtracted = exam.questions.some(
    (question) => question.answer.source === 'extracted',
  )
  return {
    csv_schema: [...CSV_SCHEMA],
    document_profile: {
      page_count: exam.pages.length,
      question_count: exam.questions.length,
      group_count: 0,
      question_pages: [
        ...new Set(exam.questions.map((question) => question.page)),
      ].sort((a, b) => a - b),
      answer_policy: {
        type: anyExtracted
          ? hasKeyPages
            ? 'separate_key'
            : 'inline_marks'
          : 'no_answer_key',
        answer_key_present: hasKeyPages,
        marking_style: '',
        worker_rule: '',
      },
    },
    assets,
    planned_rows: plannedRows,
    worker_constraints: {
      may_add_rows: false,
      may_remove_rows: false,
      may_change_grouping: false,
      may_change_image_assignments: false,
      may_change_answer_policy: false,
      may_flag_planner_disagreement: false,
    },
  }
}
