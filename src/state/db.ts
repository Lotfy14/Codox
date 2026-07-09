import Dexie, { type Table } from 'dexie'
import type { JobState } from './types'

export class CodoxDatabase extends Dexie {
  jobs!: Table<JobState, string>

  constructor() {
    super('codox')
    this.version(1).stores({
      jobs: 'id',
    })
  }
}

export const db = new CodoxDatabase()
