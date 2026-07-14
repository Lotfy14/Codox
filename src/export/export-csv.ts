/**
 * Export-time CSV projection (owner-approved 2026-07-14). The engine's
 * internal 10-column format (`CSV_SCHEMA`, the in-run `csv` artifact, the
 * gold gate) is untouched — this module only decides which columns leave
 * the device in an exported bundle:
 *
 * - `id` and `group_id` are never exported (internal keying only).
 * - `topic`/`subtopic` appear only when the user provided a topic list
 *   for the run; values come from the topic-matches artifact, blank when
 *   unmatched — never from planner heading text.
 * - `year` appears only when the run's year mode asked for it.
 *
 * Same emission contract as `emitCsv`: RFC-4180 quoting, JSON arrays
 * inside one cell for `options`/`image_urls`, CRLF endings, no BOM.
 */
import { csvLine } from '../engine/csv'
import type { MergedRow } from '../engine/types'

export interface ExportColumnFlags {
  topics: boolean
  year: boolean
}

export type ExportColumn =
  | 'topic'
  | 'subtopic'
  | 'year'
  | 'question'
  | 'options'
  | 'correct_index'
  | 'image_urls'
  | 'needs_review'

/** Column set for one run, preserving the pinned relative order. */
export function exportColumns(
  flags: ExportColumnFlags,
): readonly ExportColumn[] {
  return [
    ...(flags.topics ? (['topic', 'subtopic'] as const) : []),
    ...(flags.year ? (['year'] as const) : []),
    'question',
    'options',
    'correct_index',
    'image_urls',
    'needs_review',
  ]
}

function cell(row: MergedRow, column: ExportColumn): string {
  if (column === 'options' || column === 'image_urls') {
    return JSON.stringify(row[column])
  }
  return row[column]
}

/** Emits the exported CSV content for a run's final (projected) rows. */
export function emitExportCsv(
  rows: readonly MergedRow[],
  columns: readonly ExportColumn[],
): string {
  const lines = [csvLine(columns)]
  for (const row of rows) {
    lines.push(csvLine(columns.map((column) => cell(row, column))))
  }
  return lines.join('\r\n') + '\r\n'
}
