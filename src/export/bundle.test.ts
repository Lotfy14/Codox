import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import {
  assembleBundleFiles,
  exportArchiveName,
  safeBundleName,
  uniqueBundleNames,
  zipBundles,
} from './bundle'

describe('safeBundleName', () => {
  it('strips the .pdf extension case-insensitively', () => {
    expect(safeBundleName('exam.PDF')).toBe('exam')
    expect(safeBundleName('exam.pdf')).toBe('exam')
  })

  it('replaces path-hostile characters and trims dots/spaces', () => {
    expect(safeBundleName('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(safeBundleName('  ..weird name..  .pdf')).toBe('weird name')
  })

  it('keeps Arabic and other non-ASCII names verbatim', () => {
    expect(safeBundleName('امتحان الباطنة.pdf')).toBe('امتحان الباطنة')
  })

  it('falls back when nothing safe remains', () => {
    expect(safeBundleName('???.pdf')).toBe('exam')
    expect(safeBundleName('.pdf')).toBe('exam')
  })
})

describe('exportArchiveName', () => {
  it('preserves a single PDF name and adds the Cx suffix', () => {
    expect(exportArchiveName(['Emergency Surgery Qs.pdf'])).toBe(
      'Emergency Surgery Qs Cx.zip',
    )
  })

  it('makes batch exports identifiable without falling back to a generic name', () => {
    expect(exportArchiveName(['Cardiology.pdf', 'Renal.pdf'])).toBe(
      'Cardiology +1 more Cx.zip',
    )
  })
})

describe('uniqueBundleNames', () => {
  it('namespaces batch collisions case-insensitively, keeping case', () => {
    expect(uniqueBundleNames(['exam.pdf', 'Exam.PDF', 'exam.pdf'])).toEqual([
      'exam',
      'Exam-2',
      'exam-3',
    ])
  })

  it('leaves distinct names alone', () => {
    expect(uniqueBundleNames(['a.pdf', 'b.pdf', 'c.pdf'])).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('bundle assembly + zip', () => {
  const crop = { path: 'images/asset01.jpg', bytes: new Uint8Array([1, 2, 3]) }

  it('lays out one PDF-named Cx folder and CSV per input', () => {
    const files = assembleBundleFiles([
      { name: 'one', csvText: 'id\n1', crops: [crop] },
      { name: 'two', csvText: 'id\n2', crops: [] },
    ])
    expect(Object.keys(files).sort()).toEqual([
      'one Cx/images/asset01.jpg',
      'one Cx/one Cx.csv',
      'two Cx/two Cx.csv',
    ])
  })

  it('writes the named CSV as UTF-8 with a BOM', () => {
    const files = assembleBundleFiles([
      { name: 'one', csvText: 'id\n1', crops: [] },
    ])
    const bytes = files['one Cx/one Cx.csv']
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe('id\n1')
  })

  it('round-trips through a real zip with image bytes intact', () => {
    const files = assembleBundleFiles([
      { name: 'exam', csvText: 'id,question\n1,س؟', crops: [crop] },
    ])
    const unzipped = unzipSync(zipBundles(files))
    expect(Object.keys(unzipped).sort()).toEqual([
      'exam Cx/exam Cx.csv',
      'exam Cx/images/asset01.jpg',
    ])
    expect([...unzipped['exam Cx/images/asset01.jpg']]).toEqual([
      1, 2, 3,
    ])
    const csv = new TextDecoder().decode(
      unzipped['exam Cx/exam Cx.csv'].subarray(3),
    )
    expect(csv).toBe('id,question\n1,س؟')
  })
})
