import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import {
  assembleBundleFiles,
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
    expect(safeBundleName('???.pdf')).toBe('---')
    expect(safeBundleName('.pdf')).toBe('exam')
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

  it('lays out one folder per PDF under Triviadox_output/', () => {
    const files = assembleBundleFiles([
      { name: 'one', csvText: 'id\n1', crops: [crop] },
      { name: 'two', csvText: 'id\n2', crops: [] },
    ])
    expect(Object.keys(files).sort()).toEqual([
      'Triviadox_output/one/images/asset01.jpg',
      'Triviadox_output/one/questions.csv',
      'Triviadox_output/two/questions.csv',
    ])
  })

  it('writes questions.csv as UTF-8 with a BOM', () => {
    const files = assembleBundleFiles([
      { name: 'one', csvText: 'id\n1', crops: [] },
    ])
    const bytes = files['Triviadox_output/one/questions.csv']
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe('id\n1')
  })

  it('round-trips through a real zip with image bytes intact', () => {
    const files = assembleBundleFiles([
      { name: 'exam', csvText: 'id,question\n1,س؟', crops: [crop] },
    ])
    const unzipped = unzipSync(zipBundles(files))
    expect(Object.keys(unzipped).sort()).toEqual([
      'Triviadox_output/exam/images/asset01.jpg',
      'Triviadox_output/exam/questions.csv',
    ])
    expect([...unzipped['Triviadox_output/exam/images/asset01.jpg']]).toEqual([
      1, 2, 3,
    ])
    const csv = new TextDecoder().decode(
      unzipped['Triviadox_output/exam/questions.csv'].subarray(3),
    )
    expect(csv).toBe('id,question\n1,س؟')
  })
})
