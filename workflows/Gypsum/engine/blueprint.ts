import type { GypsumCropLink, GypsumQuestion } from './types'

const CSV_SCHEMA = [
  'id', 'topic', 'subtopic', 'year', 'question', 'options',
  'correct_index', 'image_urls', 'needs_review',
]

/**
 * Build the shared Review linkage artifact without importing another workflow.
 * Gypsum owns the extraction strategy; this object is only the app-wide output
 * contract consumed by Review, editing, backup, and export.
 */
export function buildReviewBlueprint(
  examPages: number,
  rows: readonly GypsumQuestion[],
  crops: readonly GypsumCropLink[],
  hasAnswerKey: boolean,
) {
  const rowIds = new Set(rows.map((row) => row.id))
  const assets = crops.map((crop, index) => ({
    asset_id: `gypsum-${String(index + 1).padStart(3, '0')}`,
    kind: crop.kind,
    page: crop.page,
    box_2d: crop.box,
    output_path: crop.path,
    linked_row_ids: crop.linkedLabels.filter((id) => rowIds.has(id)),
    anchor: crop.anchor,
  })).filter((asset) => asset.linked_row_ids.length > 0)

  return {
    csv_schema: CSV_SCHEMA,
    document_profile: {
      page_count: examPages,
      question_count: rows.length,
      question_pages: [...new Set(rows.flatMap((row) => row.source_page === undefined ? [] : [row.source_page]))],
      answer_policy: {
        type: hasAnswerKey ? 'separate_key' : 'no_answer_key',
        answer_key_present: hasAnswerKey,
        marking_style: hasAnswerKey ? 'printed answer letter' : 'none',
        worker_rule: hasAnswerKey ? 'copy printed answer letters only' : 'leave answers blank',
      },
    },
    assets,
    planned_rows: rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      subtopic: row.subtopic,
      year: row.year,
      question_assembly: { mode: 'plain_question_prompt', final_format: '{question_prompt}' },
      regions: {
        case_stem: null,
        question_prompt: row.source_page === undefined || row.source_box === undefined
          ? null
          : { page: row.source_page, box_2d: row.source_box },
        options: null,
        answer_evidence: null,
      },
      image_urls: [...row.image_urls],
      correct_index_policy: {
        type: hasAnswerKey ? 'separate_key' : 'blank_no_answer_key',
        value: row.correct_index,
        needs_review: row.needs_review,
      },
      worker_task: {
        case_stem_required: false,
        read_regions_only: false,
        must_follow_planner_structure: true,
      },
      ...(row.source_page === undefined ? {} : { source_pages: [row.source_page] }),
    })),
    worker_constraints: {
      may_add_rows: false,
      may_remove_rows: false,
      may_change_image_assignments: false,
      may_change_answer_policy: false,
      may_flag_planner_disagreement: false,
    },
  }
}
