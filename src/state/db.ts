import Dexie, { type Table } from 'dexie'
import type { GeminiCredential, JobState } from './types'

export interface MetadataEntry {
  key: string
  value: string
}

export class CodoxDatabase extends Dexie {
  jobs!: Table<JobState, string>
  meta!: Table<MetadataEntry, string>
  credentials!: Table<GeminiCredential, string>

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
  }
}

export const db = new CodoxDatabase()
