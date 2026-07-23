/**
 * The agent-bundle contract and its validator — the ONE gate between an
 * agent's `exam.json` and Codox's artifacts. `scripts/agent-validate.mjs`
 * runs this exact code under Node so an agent iterates to green before a
 * tutor ever imports; `src/agent-import/import.ts` runs it again in the app
 * so a hand-edited folder can never write a malformed run.
 *
 * IMPORTANT — this file must stay Node-runnable. Node 24 executes `.ts` by
 * stripping types (the repo is already `erasableSyntaxOnly` +
 * `verbatimModuleSyntax`), so:
 *   - every app import here is `import type` (erased, never resolved), and
 *   - the one RUNTIME import carries an explicit `.ts` extension and is
 *     itself dependency-free (`../engine/boxes.ts`).
 * Adding any other runtime import — especially one that reaches the DOM,
 * Dexie, or Vite — breaks the Node script. Keep this module pure.
 */
import { hasPositiveExtent, isBox2d } from '../engine/boxes.ts'
import type { Box2d } from '../engine/types'
import type { TopicItem } from '../state/types'

/** Bumped only on a breaking change to the shape below. */
export const AGENT_BUNDLE_VERSION = 1

/** The file an agent writes per exam; also what the importer looks for. */
export const EXAM_MANIFEST_NAME = 'exam.json'

/** The agent's free-text report, stored as the run's `agent-report`. */
export const NOTES_NAME = 'NOTES.md'

/**
 * Where an answer came from. This is the whole NEVER-GUESS hinge: only an
 * answer the agent SAW is allowed to fill `correct_index`.
 * - `extracted` — read off the document (printed key, mark on an option, a
 *   right-hand answer column, a margin letter). Ships like the engine's.
 * - `reasoned`  — the agent worked it out from knowledge. Lands in the
 *   `ai-answers` artifact; the row stays blank and flagged until the tutor
 *   approves it in Review, exactly like an Ask-AI answer.
 * - `none`      — no answer. Blank + flagged.
 */
export type AnswerSourceKind = 'extracted' | 'reasoned' | 'none'

/** Matches `AiConfidence` in the solver — reasoned answers only. */
export type AgentConfidence = 'certain' | 'likely' | 'unsure'

export interface AgentAnswer {
  source: AnswerSourceKind
  /** 0-based index into `options`; null/absent when there is no answer. */
  index: number | null
  /** Reasoned answers only; defaults to 'likely' when omitted. */
  confidence?: AgentConfidence
  /** Extracted answers only: what the agent saw, for the human record. */
  evidence?: string
}

export interface AgentPage {
  /** 0-based, and the run's `pageIndex`. Exam pages first, then key pages. */
  index: number
  /** Bundle-relative path, e.g. `pages/page-001.jpg`. */
  file: string
  /** Rendered pixel size — what the 0–1000 boxes are resolved against. */
  width: number
  height: number
  role: 'exam' | 'answer-key'
}

export interface AgentFigure {
  id: string
  /** Bundle-relative path of the finished image the agent produced. */
  file: string
  /** 1-based page the figure was cropped from. */
  page: number
  box: Box2d
}

export interface AgentQuestion {
  id: string
  /** Already-assembled text: `{case stem}\n\n{prompt}` when there is a stem. */
  question: string
  options: string[]
  answer: AgentAnswer
  /** Ids of `figures` entries linked to this question, in display order. */
  figures: string[]
  topic: string
  subtopic: string
  year: string
  /** 1-based page the question sits on. */
  page: number
  /** Source region on that page; omitted means "the whole page". */
  box?: Box2d
  /** Structural problem the tutor must fix, e.g. `not_mcq`. */
  flag: string
  groupId: string
}

export interface AgentExam {
  sourceFile: string
  producedBy: string
  pages: AgentPage[]
  figures: AgentFigure[]
  topics: TopicItem[]
  questions: AgentQuestion[]
}

export type AgentValidation =
  | { ok: true; exam: AgentExam; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }

// ------------------------------------------------------------------ helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Windows-style separators and `./` prefixes normalised away. */
export function normalizeBundlePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

/**
 * Page and figure bytes are stored (and exported) as JPEG, so the manifest
 * may only name JPEGs — a `.png` would ship inside the bundle under a `.jpg`
 * name once `assetJpegPath` rewrites the extension.
 */
function isJpegPath(path: string): boolean {
  return /\.jpe?g$/i.test(path)
}

// ---------------------------------------------------------------- validation

/**
 * Narrows one `exam.json` against the contract. `filesPresent` is the set of
 * bundle-relative paths that actually exist beside it — a manifest naming an
 * image nobody shipped is an error, not a broken import later.
 *
 * Errors reject the exam. Warnings degrade one question and keep going: one
 * bad question never kills a bundle, the same way one bad page never crashes
 * a run.
 */
export function validateAgentExam(
  raw: unknown,
  filesPresent: ReadonlySet<string>,
): AgentValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const fail = () => ({ ok: false as const, errors, warnings })

  if (!isRecord(raw)) {
    errors.push('exam.json must be a JSON object')
    return fail()
  }
  if (raw.codoxAgentBundle !== AGENT_BUNDLE_VERSION) {
    errors.push(
      `codoxAgentBundle must be ${AGENT_BUNDLE_VERSION} (got ${JSON.stringify(raw.codoxAgentBundle)})`,
    )
    return fail()
  }

  // ------------------------------------------------------------------ pages
  const pages: AgentPage[] = []
  const pageByNumber = new Map<number, AgentPage>()
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    errors.push('pages must be a non-empty array')
  } else {
    raw.pages.forEach((value, at) => {
      if (!isRecord(value)) {
        errors.push(`pages[${at}] must be an object`)
        return
      }
      const file = normalizeBundlePath(asString(value.file))
      const index = value.index
      const width = value.width
      const height = value.height
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        errors.push(`pages[${at}].index must be a 0-based integer`)
        return
      }
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        width <= 0 ||
        height <= 0
      ) {
        errors.push(`pages[${at}] must carry positive width and height`)
        return
      }
      if (file === '') {
        errors.push(`pages[${at}].file is required`)
        return
      }
      if (!isJpegPath(file)) {
        errors.push(`pages[${at}].file "${file}" must be a .jpg — pages are stored as JPEG`)
        return
      }
      if (!filesPresent.has(file)) {
        errors.push(`pages[${at}].file "${file}" is not in the folder`)
        return
      }
      const page: AgentPage = {
        index,
        file,
        width,
        height,
        role: value.role === 'answer-key' ? 'answer-key' : 'exam',
      }
      if (pageByNumber.has(index + 1)) {
        errors.push(`pages: duplicate index ${index}`)
        return
      }
      pages.push(page)
      pageByNumber.set(index + 1, page)
    })
  }

  // ---------------------------------------------------------------- figures
  const figures: AgentFigure[] = []
  const figureById = new Map<string, AgentFigure>()
  if (raw.figures !== undefined && !Array.isArray(raw.figures)) {
    errors.push('figures must be an array when present')
  } else {
    for (const [at, value] of (
      (raw.figures as unknown[] | undefined) ?? []
    ).entries()) {
      if (!isRecord(value)) {
        errors.push(`figures[${at}] must be an object`)
        continue
      }
      const id = asString(value.id)
      const file = normalizeBundlePath(asString(value.file))
      const page = value.page
      if (id === '') {
        errors.push(`figures[${at}].id is required`)
        continue
      }
      if (figureById.has(id)) {
        errors.push(`figures: duplicate id "${id}"`)
        continue
      }
      if (!isJpegPath(file)) {
        errors.push(
          `figures["${id}"].file "${file}" must be a .jpg — bundle images ship as JPEG`,
        )
        continue
      }
      if (!filesPresent.has(file)) {
        errors.push(`figures["${id}"].file "${file}" is not in the folder`)
        continue
      }
      if (typeof page !== 'number' || !pageByNumber.has(page)) {
        errors.push(`figures["${id}"].page ${String(page)} names no rendered page`)
        continue
      }
      if (!isBox2d(value.box) || !hasPositiveExtent(value.box)) {
        errors.push(
          `figures["${id}"].box must be [ymin, xmin, ymax, xmax] with positive extent`,
        )
        continue
      }
      const figure: AgentFigure = { id, file, page, box: value.box }
      figures.push(figure)
      figureById.set(id, figure)
    }
  }

  // ----------------------------------------------------------------- topics
  const topics: TopicItem[] = []
  if (raw.topics !== undefined && !Array.isArray(raw.topics)) {
    errors.push('topics must be an array when present')
  } else {
    for (const value of ((raw.topics as unknown[] | undefined) ?? [])) {
      if (!isRecord(value)) continue
      const topic = asString(value.topic).trim()
      if (topic === '') continue
      const subtopics = Array.isArray(value.subtopics)
        ? (value.subtopics as unknown[]).flatMap((entry) => {
            const text = asString(entry).trim()
            return text === '' ? [] : [text]
          })
        : []
      topics.push({ topic, subtopics })
    }
  }

  // -------------------------------------------------------------- questions
  const questions: AgentQuestion[] = []
  const seenIds = new Set<string>()
  if (!Array.isArray(raw.questions)) {
    errors.push('questions must be an array')
    return fail()
  }
  raw.questions.forEach((value, at) => {
    const label = `questions[${at}]`
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`)
      return
    }
    const id = asString(value.id).trim()
    if (id === '') {
      errors.push(`${label}.id is required`)
      return
    }
    // `~` is reserved: `parentRowId` splits matching rows on it, so an id
    // carrying one would make Review resolve the wrong parent region.
    if (id.includes('~')) {
      errors.push(`${label}.id "${id}" must not contain "~" (reserved)`)
      return
    }
    if (seenIds.has(id)) {
      errors.push(`questions: duplicate id "${id}"`)
      return
    }
    seenIds.add(id)

    const question = asString(value.question)
    if (question.trim() === '') {
      errors.push(`${label} ("${id}") has empty question text`)
      return
    }

    const options = Array.isArray(value.options)
      ? (value.options as unknown[]).map(asString)
      : []
    if (!Array.isArray(value.options)) {
      errors.push(`${label} ("${id}").options must be an array`)
      return
    }

    const page = value.page
    if (typeof page !== 'number' || !pageByNumber.has(page)) {
      errors.push(`${label} ("${id}").page ${String(page)} names no rendered page`)
      return
    }

    let box: Box2d | undefined
    if (value.box !== undefined) {
      if (!isBox2d(value.box) || !hasPositiveExtent(value.box)) {
        errors.push(
          `${label} ("${id}").box must be [ymin, xmin, ymax, xmax] with positive extent`,
        )
        return
      }
      box = value.box
    }

    // Degradations below never reject: they flag the row for the tutor.
    let flag = asString(value.flag).trim()
    if (options.length < 2) {
      warnings.push(`"${id}": fewer than two options — flagged not_mcq`)
      flag = 'not_mcq'
    }

    const linked: string[] = []
    for (const figureId of Array.isArray(value.figures)
      ? (value.figures as unknown[]).map(asString)
      : []) {
      if (figureById.has(figureId)) linked.push(figureId)
      else warnings.push(`"${id}": links unknown figure "${figureId}" — dropped`)
    }

    questions.push({
      id,
      question,
      options,
      answer: narrowAnswer(value.answer, options.length, id, warnings),
      figures: linked,
      topic: asString(value.topic).trim(),
      subtopic: asString(value.subtopic).trim(),
      year: asString(value.year).trim(),
      page,
      box,
      flag,
      groupId: asString(value.groupId),
    })
  })

  if (errors.length > 0) return fail()
  return {
    ok: true,
    warnings,
    exam: {
      sourceFile: asString(raw.sourceFile),
      producedBy: asString(raw.producedBy),
      pages,
      figures,
      topics,
      questions,
    },
  }
}

/**
 * An answer is only `extracted` when it names a real option. An out-of-range
 * or missing index degrades to `none` — blank + flagged — rather than being
 * repaired into some other option: NEVER-GUESS holds on the import path too.
 */
function narrowAnswer(
  raw: unknown,
  optionCount: number,
  id: string,
  warnings: string[],
): AgentAnswer {
  if (!isRecord(raw)) return { source: 'none', index: null }
  const source: AnswerSourceKind =
    raw.source === 'extracted' || raw.source === 'reasoned' ? raw.source : 'none'
  const index =
    typeof raw.index === 'number' &&
    Number.isInteger(raw.index) &&
    raw.index >= 0 &&
    raw.index < optionCount
      ? raw.index
      : null
  if (source !== 'none' && index === null) {
    warnings.push(
      `"${id}": ${source} answer has no valid option index — left blank for review`,
    )
    return { source: 'none', index: null }
  }
  const confidence: AgentConfidence =
    raw.confidence === 'certain' || raw.confidence === 'unsure'
      ? raw.confidence
      : 'likely'
  return {
    source,
    index,
    ...(source === 'reasoned' ? { confidence } : {}),
    ...(typeof raw.evidence === 'string' ? { evidence: raw.evidence } : {}),
  }
}
