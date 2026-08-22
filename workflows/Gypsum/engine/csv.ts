import type { GypsumQuestion } from './types'

const HEADERS = ['id', 'topic', 'subtopic', 'year', 'question', 'options', 'correct_index', 'image_urls', 'needs_review']

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function emitCsv(rows: readonly GypsumQuestion[]): string {
  return [HEADERS, ...rows.map((row) => [
    row.id, row.topic, row.subtopic, row.year, row.question,
    JSON.stringify(row.options), row.correct_index, JSON.stringify(row.image_urls), row.needs_review,
  ])].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
