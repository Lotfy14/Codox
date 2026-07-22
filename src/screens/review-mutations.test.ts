import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import {
  addRow,
  applyDeletions,
  blankAddedRow,
  getAdditions,
  getDeletions,
  isAddedRowId,
  setRowsDeleted,
} from './review-mutations'

function makeRow(id: string): MergedRow {
  return {
    id,
    group_id: '',
    topic: '',
    subtopic: '',
    year: '',
    question: `Q${id}`,
    options: ['A', 'B'],
    correct_index: '0',
    image_urls: [],
    needs_review: '',
  }
}

beforeEach(async () => {
  await db.runArtifacts.clear()
})

describe('applyDeletions', () => {
  it('drops only the deleted ids, preserving order', () => {
    const rows = [makeRow('1'), makeRow('2'), makeRow('3')]
    expect(applyDeletions(rows, new Set(['2'])).map((row) => row.id)).toEqual(['1', '3'])
  })

  it('is a no-op when nothing is deleted', () => {
    const rows = [makeRow('1'), makeRow('2')]
    expect(applyDeletions(rows, new Set())).toHaveLength(2)
  })
})

describe('deletions storage', () => {
  it('is reversible — a restored id filters back in', async () => {
    await setRowsDeleted('run', ['1', '2'], true)
    expect((await getDeletions('run')).sort()).toEqual(['1', '2'])
    await setRowsDeleted('run', ['1'], false)
    expect(await getDeletions('run')).toEqual(['2'])
  })

  it('never double-stores the same id', async () => {
    await setRowsDeleted('run', ['1'], true)
    await setRowsDeleted('run', ['1'], true)
    expect(await getDeletions('run')).toEqual(['1'])
  })
})

describe('additions storage', () => {
  it('appends a recognisable blank row the tutor can fill', async () => {
    const id = await addRow('run')
    expect(isAddedRowId(id)).toBe(true)
    const additions = await getAdditions('run')
    expect(additions).toHaveLength(1)
    expect(additions[0]).toEqual(blankAddedRow(id))
    // A blank added row has no answer, so it is flagged until filled.
    expect(additions[0].correct_index).toBe('')
  })

  it('appends in order across calls', async () => {
    const first = await addRow('run')
    const second = await addRow('run')
    expect((await getAdditions('run')).map((row) => row.id)).toEqual([first, second])
  })
})
