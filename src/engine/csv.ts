/**
 * RFC-4180 emit of the 10-column Triviadox contract (§3.1–3.2). Hand-rolled
 * after the 2026-07-12 package search: every maintained writer (papaparse,
 * csv-stringify, @json2csv) pulls in an order of magnitude more code than
 * these ~30 lines need.
 *
 * Contract facts enforced here:
 * - Column order is exactly `CSV_SCHEMA`.
 * - Fields containing `"` `,` CR or LF are double-quoted; a literal `"`
 *   doubles to `""`.
 * - `options` and `image_urls` are JSON arrays INSIDE one CSV cell:
 *   JSON-encode first, then CSV-quote.
 * - Output is a plain UTF-8 string (no BOM), CRLF row endings.
 */
import { CSV_SCHEMA, type MergedRow } from './types'

function csvField(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value
}

function csvLine(cells: readonly string[]): string {
  return cells.map(csvField).join(',')
}

/** Emits the complete `questions.csv` content for a run's merged rows. */
export function emitCsv(rows: readonly MergedRow[]): string {
  const lines = [csvLine(CSV_SCHEMA)]
  for (const row of rows) {
    lines.push(
      csvLine([
        row.id,
        row.group_id,
        row.topic,
        row.subtopic,
        row.year,
        row.question,
        JSON.stringify(row.options),
        row.correct_index,
        JSON.stringify(row.image_urls),
        row.needs_review,
      ]),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
