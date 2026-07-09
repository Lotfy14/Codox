import Dexie, { type Table } from 'dexie'
import type { JobState } from './types'

export interface MetadataEntry {
  key: string
  value: string
}

export class CodoxDatabase extends Dexie {
  jobs!: Table<JobState, string>
  meta!: Table<MetadataEntry, string>

  constructor() {
    super('codox')
    this.version(1).stores({
      jobs: 'id',
    })
    this.version(2).stores({
      jobs: 'id',
      meta: 'key',
    })
  }
}

export const db = new CodoxDatabase()
