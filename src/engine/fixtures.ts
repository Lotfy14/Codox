/**
 * Test fixtures for the engine suite — imported only from *.test.ts files
 * (never from app code, so it never ships). One canonical valid blueprint
 * that individual tests clone and break.
 */
import type { Blueprint, PlannedRow, WorkerRow } from './types'

export function makeRegion(page = 1) {
  return { page, box_2d: [100, 50, 300, 900] as const, anchor: 'cue' }
}

export function makePlannedRow(
  id: string,
  overrides: Partial<PlannedRow> = {},
): PlannedRow {
  return {
    id,
    group_id: `group${id}`,
    topic: '',
    subtopic: '',
    year: '',
    question_assembly: {
      mode: 'plain_question_prompt',
      final_format: '{question_prompt}',
    },
    regions: {
      case_stem: null,
      question_prompt: makeRegion(),
      options: makeRegion(),
      answer_evidence: null,
    },
    image_urls: [],
    correct_index_policy: {
      type: 'blank_no_answer_key',
      value: '',
      needs_review: 'no_answer_key',
    },
    worker_task: {
      case_stem_required: false,
      read_regions_only: false,
      must_follow_planner_structure: true,
    },
    ...overrides,
  }
}

export function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    csv_schema: [
      'id',
      'group_id',
      'topic',
      'subtopic',
      'year',
      'question',
      'options',
      'correct_index',
      'image_urls',
      'needs_review',
    ],
    document_profile: {
      page_count: 2,
      question_count: 2,
      group_count: 2,
      question_pages: [1, 2],
      answer_policy: {
        type: 'no_answer_key',
        answer_key_present: false,
        marking_style: 'none',
        worker_rule:
          'leave correct_index blank and set needs_review=no_answer_key',
      },
    },
    assets: [],
    planned_rows: [makePlannedRow('1'), makePlannedRow('2')],
    worker_constraints: {
      may_add_rows: false,
      may_remove_rows: false,
      may_change_grouping: false,
      may_change_image_assignments: false,
      may_change_answer_policy: false,
      may_flag_planner_disagreement: false,
    },
    ...overrides,
  }
}

/** A blueprint whose document policy points at visible answer evidence. */
export function makeEvidenceBlueprint(): Blueprint {
  const rows = [
    makePlannedRow('1', {
      regions: {
        case_stem: null,
        question_prompt: makeRegion(1),
        options: makeRegion(1),
        answer_evidence: makeRegion(2),
      },
      correct_index_policy: {
        type: 'extract_inline_mark',
        value: '',
        needs_review: '',
      },
    }),
    makePlannedRow('2', {
      regions: {
        case_stem: null,
        question_prompt: makeRegion(2),
        options: makeRegion(2),
        answer_evidence: makeRegion(2),
      },
      correct_index_policy: {
        type: 'extract_inline_mark',
        value: '',
        needs_review: '',
      },
    }),
  ]
  const blueprint = makeBlueprint({ planned_rows: rows })
  blueprint.document_profile.answer_policy = {
    type: 'inline_marks',
    answer_key_present: true,
    marking_style: 'circle',
    worker_rule: 'read only planner-specified mark regions',
  }
  return blueprint
}

export function makeWorkerRow(
  planned: PlannedRow,
  overrides: Partial<WorkerRow> = {},
): WorkerRow {
  return {
    id: planned.id,
    group_id: planned.group_id,
    topic: planned.topic,
    subtopic: planned.subtopic,
    year: planned.year,
    question: `Question ${planned.id}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correct_index: '',
    image_urls: [...planned.image_urls],
    needs_review: '',
    ...overrides,
  }
}

/** A raw worker chunk response body for the given planned rows. */
export function makeChunkResponse(
  rows: readonly PlannedRow[],
  perRow: (row: PlannedRow) => Partial<WorkerRow> = () => ({}),
): string {
  return JSON.stringify({
    rows: rows.map((row) => makeWorkerRow(row, perRow(row))),
  })
}
