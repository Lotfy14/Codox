import 'fake-indexeddb/auto'
import { zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_EXTENSION,
  BackupFormatError,
  backupFileName,
  collectBackup,
  createBackup,
  hasBackableWork,
  isBackupFileName,
  restoreBackup,
  unzipBackup,
  WORK_ARTIFACT_KINDS,
  zipBackup,
} from './backup'
import { db } from './db'
import { CURRENT_JOB_ID } from './jobs'

const FOLDER_ID = 'folder-1'

beforeEach(async () => {
  await Promise.all([
    db.runArtifacts.clear(),
    db.runs.clear(),
    db.files.clear(),
    db.jobs.clear(),
  ])
})

/** A folder holding one finished run with rows, a crop, and a page render. */
async function seedWork(): Promise<string> {
  await db.jobs.add({
    id: FOLDER_ID,
    createdAt: 1,
    step: 'export',
    kind: 'folder',
    name: 'Paediatrics',
    keepOriginal: true,
  })
  const runId = 'run-1'
  await db.runs.add({
    id: runId,
    jobId: FOLDER_ID,
    pdfId: 'pdf-1',
    fileName: 'paeds.pdf',
    status: 'done',
    step: 'audit',
    createdAt: 2,
    updatedAt: 3,
  })
  await db.runArtifacts.bulkAdd([
    {
      id: 'a-rows',
      runId,
      kind: 'merged-rows',
      json: [{ id: '1', question: 'Which one?' }],
      createdAt: 4,
    },
    {
      id: 'a-crop',
      runId,
      kind: 'crop',
      path: 'images/asset01.jpg',
      bytes: new Uint8Array([1, 2, 3, 4]),
      createdAt: 5,
    },
    {
      id: 'a-page',
      runId,
      kind: 'page-jpeg',
      pageIndex: 0,
      bytes: new Uint8Array([9, 9, 9]),
      width: 100,
      height: 200,
      createdAt: 6,
    },
    {
      id: 'a-chunk',
      runId,
      kind: 'chunk-response',
      json: { rows: [] },
      createdAt: 7,
    },
  ])
  await db.files.add({
    id: 'pdf-1',
    jobId: FOLDER_ID,
    kind: 'exam',
    name: 'paeds.pdf',
    size: 4,
    pageCount: 1,
    addedAt: 8,
    blob: new Blob([new Uint8Array([7, 7, 7, 7])], { type: 'application/pdf' }),
  })
  return runId
}

describe('backup file names', () => {
  it('stamps a sortable name that round-trips the extension check', () => {
    const name = backupFileName(new Date(2026, 6, 31, 9, 4), 'work')
    expect(name).toBe(`Codox backup 2026-07-31 0904${BACKUP_EXTENSION}`)
    expect(isBackupFileName(name)).toBe(true)
  })

  it('marks a full backup and honours a caller-supplied prefix', () => {
    expect(
      backupFileName(new Date(2026, 6, 31, 9, 4), 'everything', 'Codox auto'),
    ).toBe(`Codox auto 2026-07-31 0904 full${BACKUP_EXTENSION}`)
  })

  it('sorts chronologically by name, which is what pruning relies on', () => {
    const names = [
      backupFileName(new Date(2026, 6, 31, 9, 4), 'work'),
      backupFileName(new Date(2026, 6, 3, 9, 4), 'work'),
      backupFileName(new Date(2026, 6, 31, 10, 4), 'work'),
    ]
    expect([...names].sort()).toEqual([names[1], names[0], names[2]])
  })

  it('rejects a file that is not a backup', () => {
    expect(isBackupFileName('Exam Cx.zip')).toBe(false)
  })
})

describe('collectBackup', () => {
  it("keeps the tutor's irreplaceable work and drops re-derivable bulk", async () => {
    await seedWork()
    const snapshot = await collectBackup('work', '1.2.3')
    const kinds = snapshot.manifest.artifacts.map((a) => a.kind)
    expect(kinds).toContain('merged-rows')
    expect(kinds).toContain('crop')
    expect(kinds).not.toContain('page-jpeg')
    expect(kinds).not.toContain('chunk-response')
    // Crop bytes travel; the record itself no longer carries them.
    expect(snapshot.artifactBytes.get('a-crop')).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
    expect(snapshot.manifest.files).toEqual([])
  })

  it("scope 'everything' also carries pages and the original PDFs", async () => {
    await seedWork()
    const snapshot = await collectBackup('everything', '1.2.3')
    expect(snapshot.manifest.artifacts.map((a) => a.kind)).toContain(
      'page-jpeg',
    )
    expect(snapshot.manifest.files.map((f) => f.name)).toEqual(['paeds.pdf'])
    // Byte-exactness of a stored PDF is asserted at the archive level below:
    // fake-indexeddb does not round-trip a Blob, so the bytes read back here
    // are the shim's, not the ones the browser would hand over.
    expect(snapshot.fileBytes.has('pdf-1')).toBe(true)
  })

  it('leaves the ephemeral current workspace out', async () => {
    await db.jobs.add({ id: CURRENT_JOB_ID, createdAt: 1, step: 'setup' })
    await db.runs.add({
      id: 'run-current',
      jobId: CURRENT_JOB_ID,
      pdfId: 'p',
      fileName: 'draft.pdf',
      status: 'done',
      step: 'audit',
      createdAt: 1,
      updatedAt: 1,
    })
    const snapshot = await collectBackup('work', '1.2.3')
    expect(snapshot.manifest.jobs).toEqual([])
    expect(snapshot.manifest.runs).toEqual([])
  })

  it('never carries the Gemini key', async () => {
    await seedWork()
    await db.credentials.put({ id: 'gemini', apiKey: 'AIza-secret' })
    const snapshot = await collectBackup('everything', '1.2.3')
    expect(JSON.stringify(snapshot.manifest)).not.toContain('AIza-secret')
  })
})

describe('archive round trip', () => {
  it('restores runs, rows, and crop bytes onto an empty device', async () => {
    await seedWork()
    const backup = await createBackup('work', '1.2.3')
    expect(backup.folders).toBe(1)
    expect(backup.runs).toBe(1)

    await Promise.all([
      db.runArtifacts.clear(),
      db.runs.clear(),
      db.jobs.clear(),
      db.files.clear(),
    ])

    const summary = await restoreBackup(backup.bytes)
    expect(summary).toMatchObject({ folders: 1, runs: 1, skipped: 0 })
    expect((await db.jobs.get(FOLDER_ID))?.name).toBe('Paediatrics')
    expect(await db.runs.count()).toBe(1)
    const crop = await db.runArtifacts.get('a-crop')
    expect(crop?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect((await db.runArtifacts.get('a-rows'))?.json).toEqual([
      { id: '1', question: 'Which one?' },
    ])
  })

  it('carries a stored file byte-for-byte through the archive', () => {
    // The blob read itself is browser-only (see above), so the guarantee this
    // module actually owns — that whatever bytes go in come back out under the
    // same id — is asserted directly on the archive.
    const bytes = new Uint8Array([7, 7, 7, 7])
    const archive = zipBackup({
      manifest: {
        format: 'codox-backup',
        version: 1,
        scope: 'everything',
        createdAt: 1,
        appVersion: '1.2.3',
        jobs: [],
        runs: [],
        artifacts: [],
        files: [],
      },
      artifactBytes: new Map(),
      fileBytes: new Map([['pdf-1', bytes]]),
    })
    expect(unzipBackup(archive).fileBytes.get('pdf-1')).toEqual(bytes)
  })

  it("restores scope 'everything' PDFs as files of the right identity", async () => {
    await seedWork()
    const backup = await createBackup('everything', '1.2.3')
    await db.files.clear()
    const summary = await restoreBackup(backup.bytes)
    expect(summary.files).toBe(1)
    const stored = await db.files.get('pdf-1')
    expect(stored?.name).toBe('paeds.pdf')
    expect(stored?.jobId).toBe(FOLDER_ID)
    expect(stored?.blob.type).toBe('application/pdf')
  })

  it('is idempotent — restoring twice leaves one copy', async () => {
    await seedWork()
    const backup = await createBackup('work', '1.2.3')
    await restoreBackup(backup.bytes)
    await restoreBackup(backup.bytes)
    expect(await db.runs.count()).toBe(1)
    expect(await db.jobs.count()).toBe(1)
  })

  it('merges rather than replaces: work already here survives', async () => {
    await seedWork()
    const backup = await createBackup('work', '1.2.3')
    await db.jobs.clear()
    await db.runs.clear()
    await db.jobs.add({
      id: 'folder-2',
      createdAt: 9,
      step: 'setup',
      kind: 'folder',
      name: 'Kept',
    })
    await restoreBackup(backup.bytes)
    expect((await db.jobs.get('folder-2'))?.name).toBe('Kept')
    expect((await db.jobs.get(FOLDER_ID))?.name).toBe('Paediatrics')
  })

  it('never writes over the current workspace', async () => {
    await seedWork()
    const snapshot = await collectBackup('work', '1.2.3')
    // A hand-edited archive that claims the current job.
    snapshot.manifest.jobs.push({
      id: CURRENT_JOB_ID,
      createdAt: 99,
      step: 'review',
      name: 'injected',
    })
    await db.jobs.put({ id: CURRENT_JOB_ID, createdAt: 1, step: 'setup' })
    const summary = await restoreBackup(zipBackup(snapshot))
    expect((await db.jobs.get(CURRENT_JOB_ID))?.step).toBe('setup')
    expect(summary.skipped).toBe(1)
  })
})

describe('damaged and foreign archives', () => {
  it('refuses a file that is not a backup', async () => {
    await expect(restoreBackup(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      BackupFormatError,
    )
  })

  it('refuses a zip with no manifest', () => {
    expect(() => unzipBackup(zipBackupOf({ 'other.txt': 'hi' }))).toThrow(
      BackupFormatError,
    )
  })

  it('refuses an archive from a newer Codox rather than half-restoring it', async () => {
    await seedWork()
    const snapshot = await collectBackup('work', '1.2.3')
    snapshot.manifest.version = 99
    await expect(restoreBackup(zipBackup(snapshot))).rejects.toThrow(
      'newer-version',
    )
  })

  it('skips an orphan run instead of restoring a run with no job', async () => {
    await seedWork()
    const snapshot = await collectBackup('work', '1.2.3')
    snapshot.manifest.jobs = []
    const summary = await restoreBackup(zipBackup(snapshot))
    expect(summary.runs).toBe(0)
    expect(summary.artifacts).toBe(0)
    expect(summary.skipped).toBeGreaterThan(0)
  })

  it('drops a crop whose bytes are missing rather than restoring a blank one', async () => {
    await seedWork()
    const snapshot = await collectBackup('work', '1.2.3')
    snapshot.artifactBytes.delete('a-crop')
    await db.runArtifacts.clear()
    const summary = await restoreBackup(zipBackup(snapshot))
    expect(await db.runArtifacts.get('a-crop')).toBeUndefined()
    expect(summary.skipped).toBe(1)
    // The row artifact beside it still restores — one bad record is not a
    // reason to lose the run.
    expect(await db.runArtifacts.get('a-rows')).toBeDefined()
  })
})

describe('hasBackableWork', () => {
  it('is false on a fresh device and true once a folder exists', async () => {
    expect(await hasBackableWork()).toBe(false)
    await seedWork()
    expect(await hasBackableWork()).toBe(true)
  })

  it('ignores the current workspace on its own', async () => {
    await db.runs.add({
      id: 'run-current',
      jobId: CURRENT_JOB_ID,
      pdfId: 'p',
      fileName: 'draft.pdf',
      status: 'done',
      step: 'audit',
      createdAt: 1,
      updatedAt: 1,
    })
    expect(await hasBackableWork()).toBe(false)
  })
})

describe('the backed-up kind list', () => {
  it('carries every artifact review and export read', () => {
    // These are the artifacts a restored run needs to be reviewable and
    // exportable; a kind dropped from this list silently loses tutor work.
    for (const kind of [
      'merged-rows',
      'review-resolutions',
      'review-edits',
      'review-deletions',
      'review-additions',
      'ai-answers',
      'topics-list',
      'topic-matches',
      'crop',
    ] as const) {
      expect(WORK_ARTIFACT_KINDS).toContain(kind)
    }
  })
})

/** A well-formed zip that simply is not a Codox backup. */
function zipBackupOf(entries: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const files: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(entries)) {
    files[path] = encoder.encode(text)
  }
  return zipSync(files)
}
