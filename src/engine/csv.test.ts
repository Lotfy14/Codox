import { describe, expect, it } from 'vitest'
import { emitCsv } from './csv'
import type { MergedRow } from './types'

function makeRow(overrides: Partial<MergedRow> = {}): MergedRow {
  return {
    id: '1',
    group_id: 'group01',
    topic: '',
    subtopic: '',
    year: '',
    question: 'What is the diagnosis?',
    options: ['Appendicitis', 'Cholecystitis'],
    correct_index: '',
    image_urls: [],
    needs_review: 'no_answer_key',
    ...overrides,
  }
}

const HEADER =
  'id,group_id,topic,subtopic,year,question,options,correct_index,image_urls,needs_review'

/** Minimal RFC-4180 reader used only to round-trip what we emit. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

describe('emitCsv', () => {
  it('emits the exact 10-column header and CRLF rows', () => {
    const csv = emitCsv([makeRow()])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(HEADER)
    expect(lines).toHaveLength(3) // header + row + trailing empty
    expect(lines[2]).toBe('')
    expect(csv.charCodeAt(0)).not.toBe(0xfeff) // no BOM
  })

  it('a plain row needs no quoting and JSON-encodes the array cells', () => {
    const csv = emitCsv([makeRow()])
    const row = csv.split('\r\n')[1]
    expect(row).toBe(
      '1,group01,,,,What is the diagnosis?,"[""Appendicitis"",""Cholecystitis""]",,[],no_answer_key',
    )
  })

  it('quotes and doubles fields containing quotes, commas, and newlines', () => {
    const csv = emitCsv([
      makeRow({
        question: 'He said "acute", then\npaused, twice',
      }),
    ])
    expect(csv).toContain('"He said ""acute"", then\npaused, twice"')
  })

  it('options containing quotes, commas, and newlines survive a full round-trip', () => {
    const nasty = [
      'A "quoted" option',
      'commas, inside',
      'line\nbreak',
      'زائدة دودية',
    ]
    const csv = emitCsv([makeRow({ options: nasty, correct_index: '2' })])
    // Re-parse the row (the embedded LF stays inside its quoted field —
    // rows end with CRLF): decode the CSV cell first, then JSON-parse.
    const body = csv.slice(HEADER.length + 2, -2)
    const cells = parseCsvLine(body)
    expect(cells).toHaveLength(10)
    expect(JSON.parse(cells[6])).toEqual(nasty)
    expect(cells[7]).toBe('2')
  })

  it('keeps UTF-8 text (Arabic headers, medical terms) untouched', () => {
    const csv = emitCsv([
      makeRow({ topic: 'الجراحة', question: 'Crohn’s disease?' }),
    ])
    expect(csv).toContain('الجراحة')
    expect(csv).toContain('Crohn’s disease?')
  })

  it('blank correct_index stays a truly empty cell — never 0', () => {
    const csv = emitCsv([makeRow({ correct_index: '' })])
    const cells = parseCsvLine(csv.split('\r\n')[1])
    expect(cells[7]).toBe('')
  })

  it('image_urls emit as a JSON array cell with relative paths', () => {
    const csv = emitCsv([
      makeRow({ image_urls: ['images/asset01.jpg', 'images/asset02.jpg'] }),
    ])
    const cells = parseCsvLine(csv.split('\r\n')[1])
    expect(JSON.parse(cells[8])).toEqual([
      'images/asset01.jpg',
      'images/asset02.jpg',
    ])
  })
})
