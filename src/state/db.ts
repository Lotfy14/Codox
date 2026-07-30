import Dexie, { type Table } from 'dexie'
import type {
  GeminiCredential,
  JobState,
  LogEvent,
  RunArtifact,
  RunState,
  StoredPdf,
} from './types'

export interface MetadataEntry {
  key: string
  value: string
}

/**
 * A live handle to something outside the database — currently only the folder
 * the tutor picked for automatic backups. Handles are structured-cloneable, so
 * IndexedDB is the only place they can be kept across reloads; they cannot go
 * in `meta`, whose value is a string.
 */
export interface HandleEntry {
  key: string
  handle: FileSystemDirectoryHandle
}

export class CodoxDatabase extends Dexie {
  jobs!: Table<JobState, string>
  meta!: Table<MetadataEntry, string>
  credentials!: Table<GeminiCredential, string>
  files!: Table<StoredPdf, string>
  runs!: Table<RunState, string>
  runArtifacts!: Table<RunArtifact, string>
  logs!: Table<LogEvent, number>
  handles!: Table<HandleEntry, string>

  constructor() {
    super('codox')
    this.version(1).stores({
      jobs: 'id',
    })
    this.version(2).stores({
      jobs: 'id',
      meta: 'key',
    })
    // Phase 4: the singleton Gemini credential. Additive only — existing
    // jobs/meta rows survive the version bump untouched.
    this.version(3).stores({
      jobs: 'id',
      meta: 'key',
      credentials: 'id',
    })
    // Phase 5: the job's stored PDFs (exam files + at most one answer
    // key). Additive only, as above.
    this.version(4).stores({
      jobs: 'id',
      meta: 'key',
      credentials: 'id',
      files: 'id, jobId',
    })
    // Phase 6: engine runs and their per-step artifacts. The artifact
    // rows ARE the checkpoint — §1.3's "each step writes its inputs and
    // outputs to disk before the next step starts" is also exactly what
    // resume needs. Additive only.
    this.version(5).stores({
      jobs: 'id',
      meta: 'key',
      credentials: 'id',
      files: 'id, jobId',
      runs: 'id, jobId, pdfId',
      runArtifacts: 'id, runId, [runId+kind], [runId+kind+pageIndex]',
    })
    // Phase 7: the on-device diagnostics log. Additive only.
    this.version(6).stores({
      jobs: 'id',
      meta: 'key',
      credentials: 'id',
      files: 'id, jobId',
      runs: 'id, jobId, pdfId',
      runArtifacts: 'id, runId, [runId+kind], [runId+kind+pageIndex]',
      logs: '++seq, t, scope, runId',
    })
    // Folders (owner-approved 2026-07-22): index `jobs.kind` so the Folders
    // tab lists persistent folder jobs cheaply. Additive only — existing
    // jobs simply have no `kind` and never match the folder query.
    this.version(7).stores({
      jobs: 'id, kind',
      meta: 'key',
      credentials: 'id',
      files: 'id, jobId',
      runs: 'id, jobId, pdfId',
      runArtifacts: 'id, runId, [runId+kind], [runId+kind+pageIndex]',
      logs: '++seq, t, scope, runId',
    })
    // Automatic backups: the picked folder's handle. Additive only — a
    // database with no handle simply has no automatic backup configured.
    this.version(8).stores({
      jobs: 'id, kind',
      meta: 'key',
      credentials: 'id',
      files: 'id, jobId',
      runs: 'id, jobId, pdfId',
      runArtifacts: 'id, runId, [runId+kind], [runId+kind+pageIndex]',
      logs: '++seq, t, scope, runId',
      handles: 'key',
    })
  }
}

export const db = new CodoxDatabase()
