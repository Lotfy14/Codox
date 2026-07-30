import { describe, expect, it } from 'vitest'
import { isAutoBackupDue, prunableBackups } from './auto-backup'
import { backupFileName } from './backup'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 6, 31, 12, 0)

function autoName(day: number, hour = 9): string {
  return backupFileName(
    new Date(2026, 6, day, hour, 0),
    'work',
    'Codox auto-backup',
  )
}

describe('isAutoBackupDue', () => {
  it('always writes after a finished batch — the work just changed', () => {
    expect(isAutoBackupDue('batch-finished', NOW - 1000, NOW)).toBe(true)
  })

  it('writes at launch when nothing has ever been backed up', () => {
    expect(isAutoBackupDue('startup', null, NOW)).toBe(true)
  })

  it('skips a launch soon after the last backup', () => {
    expect(isAutoBackupDue('startup', NOW - 2 * HOUR, NOW)).toBe(false)
  })

  it('writes at launch once the last backup has gone stale', () => {
    expect(isAutoBackupDue('startup', NOW - 13 * HOUR, NOW)).toBe(true)
  })
})

describe('prunableBackups', () => {
  it('keeps the newest five and drops the rest', () => {
    const names = [1, 2, 3, 4, 5, 6, 7].map((day) => autoName(day))
    expect(prunableBackups(names)).toEqual([autoName(1), autoName(2)])
  })

  it('keeps everything while under the limit', () => {
    expect(prunableBackups([autoName(1), autoName(2)])).toEqual([])
  })

  it('never prunes a backup the tutor saved by hand', () => {
    const manual = backupFileName(new Date(2026, 0, 1, 9, 0), 'work')
    const names = [manual, ...[1, 2, 3, 4, 5, 6].map((day) => autoName(day))]
    const pruned = prunableBackups(names)
    expect(pruned).toEqual([autoName(1)])
    expect(pruned).not.toContain(manual)
  })

  it('ignores unrelated files sitting in the same folder', () => {
    const names = [
      'notes.txt',
      'Exam Cx.zip',
      ...[1, 2, 3, 4, 5, 6].map((day) => autoName(day)),
    ]
    expect(prunableBackups(names)).toEqual([autoName(1)])
  })

  it('prunes by timestamp, not by the order the folder listed them', () => {
    const names = [autoName(9), autoName(10), autoName(2), autoName(1)]
    expect(prunableBackups(names, 2)).toEqual([autoName(1), autoName(2)])
  })

  it('orders same-day backups by time of day', () => {
    const names = [autoName(1, 18), autoName(1, 9), autoName(1, 13)]
    expect(prunableBackups(names, 1)).toEqual([
      autoName(1, 9),
      autoName(1, 13),
    ])
  })
})
