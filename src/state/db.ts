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

export class CodoxDatabase extends Dexie {
  jobs!: Table<JobState, string>
  meta!: Table<MetadataEntry, string>
  credentials!: Table<GeminiCredential, string>
  files!: Table<StoredPdf, string>
  runs!: Table<RunState, string>
  runArtifacts!: Table<RunArtifact, string>
  logs!: Table<LogEvent, number>

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
  }
}

export const db = new CodoxDatabase()
