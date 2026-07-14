/** Deterministic construction of the pinned Blueprint from observed stages. */
import type { Blueprint, BlueprintAsset, PlannedRow, Region } from './types'
import type { ReconciledIndex } from './enumerate'
import type { BoxResult, EvidenceMap } from './index-pass'

const PLAIN_FORMAT = '{question_prompt}'
const CASE_FORMAT = 'Case stem: {case_stem}\nQuestion: {question_prompt}'

export interface AssembleInput {
  index: ReconciledIndex
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
    const geometry = boxed.get(question.ref)
    if (geometry === undefined) return
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
