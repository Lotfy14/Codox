/** Deterministic construction of the pinned Blueprint from observed stages. */
import type { Blueprint, BlueprintAsset, PlannedRow, Region } from './types'
import type { ReconciledIndex } from './enumerate'
import type { BoxResult, EvidenceMap } from './index-pass'

const PLAIN_FORMAT = '{question_prompt}'
// Owner-approved 2026-07-15 (CODOX_MIGRATION §2.2): the printed case identity
// stays in the stem text ("Case 10 …"), no "Case stem:"/"Question:" labels, a
// blank line between stem and prompt. Deterministic code — not the worker —
// now assembles this from the two verbatim fields.
const CASE_FORMAT = '{case_stem}\n\n{question_prompt}'

export interface AssembleInput {
  /** Only the reconciled questions are assembled; page manifests, planning
   *  issues, and dropped observations are diagnostics the executor owns. */
  index: Pick<ReconciledIndex, 'questions'>
  boxes: BoxResult
  evidence: EvidenceMap
  pageCount: number
}
function blankPolicy(reason: string) {
  return { type: 'blank_' + reason, value: '', needs_review: reason }
}
function evidencePolicy(state: string, region: Region | null) {
  if (state === 'ambiguous') return blankPolicy('conflicting_marks')
  if (state === 'illegible') return blankPolicy('key_unclear')
  if (region === null) return blankPolicy('no_visible_answer')
  return { type: 'extract_visible_evidence', value: '', needs_review: '' }
}

// A page footer sits near the bottom edge; stop an extended options box short
// of it so a page number or running title is never boxed as an option.
const OPTIONS_FOOTER_LIMIT = 975

/**
 * Deterministic options-box repair. The BOX role is the weakest model and,
 * on single-page BOX with gemini-3.1-flash-lite, sometimes draws a row's
 * options box around only the FIRST option — a sentence-completion stem whose
 * choices continue below gets clipped to option "a", and the worker faithfully
 * transcribes just that one region (observed 2026-07-18: options box only ~84
 * of 1000 tall, one line).
 *
 * A question's options always lie between its own prompt and the start of the
 * next question on the same page, so code — not the model — bounds them here:
 * grow (never shrink) each row's options box down to the nearest following
 * prompt/case-stem in the same column, or a footer margin when it is the last
 * on the page. Column membership is enforced by x-overlap so a neighboring
 * column's question cannot cap a box early. The box is also widened to the
 * question's own prompt column so right-shifted or wrapped options are not
 * clipped horizontally. Never crosses into another question's text: the bound
 * is that question's top, and a following case stem stops the box before it.
 */
function extendClippedOptionBoxes(rows: PlannedRow[]): void {
  for (const row of rows) {
    const opts = row.regions.options
    if (opts === null) continue
    const [oy0, ox0, oy1, ox1] = opts.box_2d
    let nextTop = OPTIONS_FOOTER_LIMIT
    for (const other of rows) {
      if (other === row) continue
      for (const region of [other.regions.case_stem, other.regions.question_prompt]) {
        if (region === null || region.page !== opts.page) continue
        const [ry0, rx0, , rx1] = region.box_2d
        const sameColumn = rx1 > ox0 && rx0 < ox1
        if (ry0 > oy0 && ry0 < nextTop && sameColumn) nextTop = ry0
      }
    }
    const prompt = row.regions.question_prompt
    const inColumn = prompt !== null && prompt.page === opts.page
    const newX0 = inColumn ? Math.min(ox0, prompt.box_2d[1]) : ox0
    const newX1 = inColumn ? Math.max(ox1, prompt.box_2d[3]) : ox1
    const newY1 = Math.max(oy1, nextTop)
    if (newY1 !== oy1 || newX0 !== ox0 || newX1 !== ox1) {
      row.regions.options = { ...opts, box_2d: [oy0, newX0, newY1, newX1] }
    }
  }
}

export function assembleBlueprint(input: AssembleInput): Blueprint {
  const boxed = new Map(input.boxes.questions.map((question) => [question.ref, question]))
  const evidence = new Map(input.evidence.evidence.map((item) => [item.ref, item]))
  const labels = input.index.questions.map((question) => question.printedLabel)
  const labelsUnique = labels.every((label, i) => labels.indexOf(label) === i && label !== '')
  const groupIds = new Map<string, string>()
  let groupCount = 0
  const resolveGroup = (key: string) => {
    let value = groupIds.get(key)
    if (value === undefined) {
      groupCount += 1
      value = 'group' + String(groupCount).padStart(2, '0')
      groupIds.set(key, value)
    }
    return value
  }
  const rows: PlannedRow[] = []
  const refToId = new Map<string, string>()
  input.index.questions.forEach((question) => {
    const fallbackPage = question.sourcePages[0] ?? question.ownerPage
    const wholePage: Region = { page: fallbackPage, box_2d: [0, 0, 1000, 1000] }
    const geometry = boxed.get(question.ref) ?? {
      ref: question.ref,
      question: wholePage,
      options: wholePage,
      caseStem: question.caseStemKey !== null ? wholePage : null,
      inlineEvidence: question.evidenceState === 'inline' ? wholePage : null,
    }
    const id = labelsUnique ? question.printedLabel : String(rows.length + 1)
    refToId.set(question.ref, id)
    const keyEvidence = evidence.get(question.ref)
    const answerRegion = keyEvidence?.region ?? geometry.inlineEvidence
    const answerState = keyEvidence?.state ?? question.evidenceState
    const hasCase = question.caseStemKey !== null && geometry.caseStem !== null
    rows.push({
      id,
      group_id: resolveGroup(question.caseStemKey ?? question.ref),
      topic: '',
      subtopic: '',
      year: question.visibleYear,
      question_assembly: {
        mode: hasCase ? 'case_stem_plus_question_prompt' : 'plain_question_prompt',
        final_format: hasCase ? CASE_FORMAT : PLAIN_FORMAT,
      },
      regions: {
        case_stem: hasCase ? geometry.caseStem : null,
        question_prompt: geometry.question,
        options: question.optionsPresent ? (geometry.options ?? geometry.question) : null,
        answer_evidence: answerRegion,
      },
      image_urls: [],
      correct_index_policy: evidencePolicy(answerState, answerRegion),
      worker_task: {
        case_stem_required: hasCase,
        read_regions_only: false,
        must_follow_planner_structure: true,
      },
      source_pages: question.sourcePages,
    })
  })
  extendClippedOptionBoxes(rows)
  const assets: BlueprintAsset[] = []
  input.boxes.figures.forEach((figure) => {
    const linkedRowIds = figure.linkedRefs.flatMap((ref) => {
      const id = refToId.get(ref)
      return id === undefined ? [] : [id]
    })
    if (linkedRowIds.length === 0) return
    const path = 'images/asset' + String(assets.length + 1).padStart(2, '0') + '.jpg'
    assets.push({
      asset_id: 'asset' + String(assets.length + 1).padStart(2, '0'),
      kind: 'question_figure',
      page: figure.page,
      box_2d: figure.box,
      output_path: path,
      linked_group_id: '',
      linked_row_ids: linkedRowIds,
      anchor: figure.anchor,
    })
    for (const row of rows) {
      if (linkedRowIds.includes(row.id)) row.image_urls.push(path)
    }
  })
  const questionPages = [...new Set(rows.flatMap((row) => row.source_pages ?? [row.regions.question_prompt?.page ?? 0]).filter(Boolean))].sort((a,b) => a-b)
  return {
    csv_schema: ['id', 'group_id', 'topic', 'subtopic', 'year', 'question', 'options', 'correct_index', 'image_urls', 'needs_review'],
    document_profile: {
      page_count: input.pageCount,
      question_count: rows.length,
      group_count: new Set(rows.map((row) => row.group_id)).size,
      question_pages: questionPages,
      answer_policy: {
        type: input.evidence.type,
        answer_key_present: input.evidence.type === 'separate_key' || input.evidence.type === 'mixed',
        marking_style: input.evidence.markingStyle,
        worker_rule: 'extract only from planner-specified visible evidence',
      },
    },
    assets,
    planned_rows: rows,
    worker_constraints: {
      may_add_rows: false, may_remove_rows: false, may_change_grouping: false,
      may_change_image_assignments: false, may_change_answer_policy: false,
      may_flag_planner_disagreement: false,
    },
  }
}
