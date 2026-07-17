import { describe, expect, it } from 'vitest'
import type { MergedRow } from '../engine/types'
import { emitExportCsv, exportColumns } from './export-csv'

function makeRow(overrides: Partial<MergedRow> = {}): MergedRow {
  return {
    id: '1',
    group_id: 'group01',
    topic: 'Surgery',
    subtopic: 'Appendix',
    year: '2023',
    question: 'What is the diagnosis?',
    options: ['Appendicitis', 'Cholecystitis'],
    correct_index: '1',
    image_urls: ['images/asset01.jpg'],
    needs_review: '',
    ...overrides,
  }
}

const BASE_HEADER = 'question,options,correct_index,image_url'

describe('exportColumns', () => {
  it('never includes id, group_id, or needs_review, whatever the flags', () => {
    for (const topics of [false, true]) {
      for (const year of [false, true]) {
        const columns = exportColumns({ topics, year })
        expect(columns).not.toContain('id')
        expect(columns).not.toContain('group_id')
        expect(columns).not.toContain('needs_review')
      }
    }
  })

  it('base flags yield exactly the four always-present columns', () => {
    expect(exportColumns({ topics: false, year: false })).toEqual([
      'question',
      'options',
      'correct_index',
      'image_urls',
    ])
  })

  it('optional columns keep the pinned relative order', () => {
    expect(exportColumns({ topics: true, year: true })).toEqual([
      'topic',
      'subtopic',
      'year',
      'question',
      'options',
      'correct_index',
      'image_urls',
    ])
    expect(exportColumns({ topics: true, year: false })[0]).toBe('topic')
    expect(exportColumns({ topics: false, year: true })[0]).toBe('year')
  })
})

describe('emitExportCsv', () => {
  it('emits header + CRLF rows without BOM, like emitCsv', () => {
    const csv = emitExportCsv(
      [makeRow()],
      exportColumns({ topics: false, year: false }),
    )
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(BASE_HEADER)
    expect(lines).toHaveLength(3) // header + row + trailing empty
    expect(lines[2]).toBe('')
    expect(csv.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('drops id/group_id values from every row', () => {
    const csv = emitExportCsv(
      [makeRow()],
      exportColumns({ topics: false, year: false }),
    )
    expect(csv).not.toContain('group01')
    expect(csv.split('\r\n')[1]).toBe(
      'What is the diagnosis?,"[""Appendicitis"",""Cholecystitis""]",1,"[""images/asset01.jpg""]"',
    )
  })

  it('includes topic/subtopic/year cells when the columns are on', () => {
    const csv = emitExportCsv(
      [makeRow()],
      exportColumns({ topics: true, year: true }),
    )
    expect(csv.split('\r\n')[1]).toBe(
      'Surgery,Appendix,2023,What is the diagnosis?,"[""Appendicitis"",""Cholecystitis""]",1,"[""images/asset01.jpg""]"',
    )
  })

  it('unmatched rows keep truly blank topic cells', () => {
    const csv = emitExportCsv(
      [makeRow({ topic: '', subtopic: '' })],
      exportColumns({ topics: true, year: false }),
    )
    expect(csv.split('\r\n')[1].startsWith(',,What is')).toBe(true)
  })

  it('quotes fields with quotes, commas, and newlines (RFC-4180 parity)', () => {
    const csv = emitExportCsv(
      [makeRow({ question: 'He said "acute", then\npaused' })],
      exportColumns({ topics: false, year: false }),
    )
    expect(csv).toContain('"He said ""acute"", then\npaused"')
  })
})
