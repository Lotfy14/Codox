/**
 * Backup and restore — the recovery half of "the app must never be the sole
 * holder of a user's work" (export-early law). `src/state/persist.ts` stops
 * the browser evicting the database; this module makes an eviction survivable
 * when it happens anyway (a cleared profile, a reinstall, a new device).
 *
 * A backup is one zip:
 *
 *   backup.json          the manifest — jobs, runs, and artifact records
 *   bytes/<artifactId>   raw bytes for artifacts that carry them (crops, pages)
 *   files/<fileId>       original PDF/image bytes (scope 'everything' only)
 *
 * Two scopes, because size and value diverge sharply:
 *
 *   'work'       — everything the tutor cannot get back: extracted rows, the
 *                  CSV, review resolutions/edits/deletions/additions, approved
 *                  AI answers, topic lists and matches, and the figure crops
 *                  export ships. Small enough to write automatically.
 *   'everything' — the above plus the original PDFs and the rendered page
 *                  images, so a restored run reviews with its page previews
 *                  and can be re-run. Large; a deliberate choice.
 *
 * Deliberately never backed up: the Gemini API key. The key stays on-device
 * (CLAUDE.md) and a backup file is a thing tutors copy to drives and share —
 * a key must never ride along. Restoring asks for the key again, which is the
 * correct amount of friction.
 *
 * Restore is additive and idempotent: records are keyed by their own ids and
 * written with `bulkPut`, so restoring the same file twice changes nothing and
 * restoring onto a live database merges rather than replaces. Nothing here
 * touches the engine path, and no row's content is ever repaired or invented —
 * a record that fails validation is skipped and counted, never guessed at.
 */
import { unzipSync, zipSync } from 'fflate'
import { db } from './db'
import { CURRENT_JOB_ID } from './jobs'
import type { JobState, RunArtifact, RunArtifactKind, RunState } from './types'

export const BACKUP_FORMAT = 'codox-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_EXTENSION = '.codoxbackup'
const MANIFEST_PATH = 'backup.json'
const BYTES_PREFIX = 'bytes/'
const FILES_PREFIX = 'files/'

export type BackupScope = 'work' | 'everything'

/**
 * The irreplaceable artifacts. Everything omitted here is either re-derivable
 * from the PDF (page renders, page text) or an intermediate the engine only
 * needed mid-run (raw blueprints, index windows, per-chunk requests and
 * responses) — keeping them would multiply a backup's size for no recovery
 * value. `crop` is in because export ships those exact bytes.
 */
export const WORK_ARTIFACT_KINDS: readonly RunArtifactKind[] = [
  'blueprint-valid',
  'merged-rows',
  'csv',
  'audit-report',
  'review-resolutions',
  'review-edits',
  'review-deletions',
  'review-additions',
  'ai-answers',
  'topics-list',
  'topic-matches',
  'agent-report',
  'crop',
]

/** Scope 'everything' additionally keeps the rendered pages and their text. */
const EXTRA_EVERYTHING_KINDS: readonly RunArtifactKind[] = [
  'page-jpeg',
  'page-text',
]

export function artifactKindsForScope(
  scope: BackupScope,
): readonly RunArtifactKind[] {
  return scope === 'everything'
    ? [...WORK_ARTIFACT_KINDS, ...EXTRA_EVERYTHING_KINDS]
    : WORK_ARTIFACT_KINDS
}

/** An artifact record with its bytes lifted out into a separate zip entry. */
type ArtifactRecord = Omit<RunArtifact, 'bytes'> & { hasBytes?: true }

/** A stored file's record with its blob lifted out into a zip entry. */
interface FileRecord {
  id: string
  jobId: string
  kind: 'exam' | 'answer-key' | 'topics'
  parentPdfId?: string
  source?: string
  name: string
  size: number
  pageCount: number
  addedAt: number
  type: string
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  scope: BackupScope
  createdAt: number
  appVersion: string
  jobs: JobState[]
  runs: RunState[]
  artifacts: ArtifactRecord[]
  files: FileRecord[]
}

/** Everything a backup holds, before it is zipped. */
export interface BackupSnapshot {
  manifest: BackupManifest
  /** artifact id → bytes */
  artifactBytes: Map<string, Uint8Array>
  /** file id → bytes */
  fileBytes: Map<string, Uint8Array>
}

export interface RestoreSummary {
  scope: BackupScope
  createdAt: number
  folders: number
  runs: number
  artifacts: number
  files: number
  /** Records dropped because they were malformed — never repaired. */
  skipped: number
}

export class BackupFormatError extends Error {}

/* ------------------------------------------------------------------ *
 * Pure assembly / parsing
 * ------------------------------------------------------------------ */

/**
 * `2026-07-31T09:04` → `Codox backup 2026-07-31 0904.codoxbackup`. The stamp
 * sorts lexicographically, which is what lets the automatic backup prune its
 * own oldest files by name alone. `prefix` keeps automatic files in their own
 * namespace so pruning can never delete a backup the tutor saved by hand.
 */
export function backupFileName(
  at: Date,
  scope: BackupScope,
  prefix = 'Codox backup',
): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    ` ${pad(at.getHours())}${pad(at.getMinutes())}`
  const suffix = scope === 'everything' ? ' full' : ''
  return `${prefix} ${stamp}${suffix}${BACKUP_EXTENSION}`
}

/** True for a file name this app should offer to restore. */
export function isBackupFileName(name: string): boolean {
  return name.toLowerCase().endsWith(BACKUP_EXTENSION)
}

export function zipBackup(snapshot: BackupSnapshot): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [MANIFEST_PATH]: [
      new TextEncoder().encode(JSON.stringify(snapshot.manifest)),
      { level: 6 },
    ],
  }
  // JPEGs and PDFs are already compressed; storing them keeps a large
  // backup from pinning the main thread for seconds on end.
  for (const [id, bytes] of snapshot.artifactBytes) {
    entries[`${BYTES_PREFIX}${id}`] = [bytes, { level: 0 }]
  }
  for (const [id, bytes] of snapshot.fileBytes) {
    entries[`${FILES_PREFIX}${id}`] = [bytes, { level: 0 }]
  }
  return zipSync(entries)
}

export function unzipBackup(bytes: Uint8Array): BackupSnapshot {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new BackupFormatError('not-a-backup')
  }
  const manifestBytes = files[MANIFEST_PATH]
  if (manifestBytes === undefined) throw new BackupFormatError('not-a-backup')

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes))
  } catch {
    throw new BackupFormatError('not-a-backup')
  }
  const manifest = parsed as Partial<BackupManifest>
  if (manifest?.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('not-a-backup')
  }
  if (typeof manifest.version !== 'number') {
    throw new BackupFormatError('not-a-backup')
  }
  // Forward compatibility is not guessed at: a newer file may hold records
  // this build cannot interpret, so it is refused rather than half-restored.
  if (manifest.version > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError('newer-version')
  }

  const artifactBytes = new Map<string, Uint8Array>()
  const fileBytes = new Map<string, Uint8Array>()
  for (const [path, entry] of Object.entries(files)) {
    if (path.startsWith(BYTES_PREFIX)) {
      artifactBytes.set(path.slice(BYTES_PREFIX.length), entry)
    } else if (path.startsWith(FILES_PREFIX)) {
      fileBytes.set(path.slice(FILES_PREFIX.length), entry)
    }
  }
  return {
    manifest: {
      format: BACKUP_FORMAT,
      version: manifest.version,
      scope: manifest.scope === 'everything' ? 'everything' : 'work',
      createdAt:
        typeof manifest.createdAt === 'number' ? manifest.createdAt : 0,
      appVersion:
        typeof manifest.appVersion === 'string' ? manifest.appVersion : '',
      jobs: Array.isArray(manifest.jobs) ? manifest.jobs : [],
      runs: Array.isArray(manifest.runs) ? manifest.runs : [],
      artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts : [],
      files: Array.isArray(manifest.files) ? manifest.files : [],
    },
    artifactBytes,
    fileBytes,
  }
}

/** A record is restorable only when its own identity is intact. */
function hasId(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id !== ''
  )
}

function isRestorableRun(value: unknown): value is RunState {
  return hasId(value) && typeof (value as RunState).jobId === 'string'
}

function isRestorableArtifact(value: unknown): value is ArtifactRecord {
  return (
    hasId(value) &&
    typeof (value as ArtifactRecord).runId === 'string' &&
    typeof (value as ArtifactRecord).kind === 'string'
  )
}

/* ------------------------------------------------------------------ *
 * Database IO
 * ------------------------------------------------------------------ */

/**
 * `Blob.arrayBuffer` is missing on older Android WebViews (and on the Blob
 * shim IndexedDB hands back under test), where `Response` reads the same
 * bytes. Reading a stored PDF must not depend on which of the two a shell has.
 */
async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Response(blob).arrayBuffer()
}

/**
 * Reads the backup's contents out of Dexie. The `current` workspace is left
 * out on purpose: it is the ephemeral scratch job, archived into History the
 * moment its batch finishes, so backing it up would restore a half-finished
 * workspace over a live one.
 */
export async function collectBackup(
  scope: BackupScope,
  appVersion: string,
): Promise<BackupSnapshot> {
  const kinds = new Set(artifactKindsForScope(scope))
  const jobs = (await db.jobs.toArray()).filter(
    (job) => job.id !== CURRENT_JOB_ID,
  )
  const jobIds = new Set(jobs.map((job) => job.id))
  const runs = (await db.runs.toArray()).filter((run) => jobIds.has(run.jobId))

  const artifacts: ArtifactRecord[] = []
  const artifactBytes = new Map<string, Uint8Array>()
  for (const run of runs) {
    const rows = await db.runArtifacts.where('runId').equals(run.id).toArray()
    for (const row of rows) {
      if (!kinds.has(row.kind)) continue
      const { bytes, ...record } = row
      if (bytes !== undefined && bytes.byteLength > 0) {
        artifactBytes.set(row.id, bytes)
        artifacts.push({ ...record, hasBytes: true })
      } else {
        artifacts.push(record)
      }
    }
  }

  const fileRecords: FileRecord[] = []
  const fileBytes = new Map<string, Uint8Array>()
  if (scope === 'everything') {
    const stored = (await db.files.toArray()).filter((file) =>
      jobIds.has(file.jobId),
    )
    for (const file of stored) {
      const { blob, ...rest } = file
      fileBytes.set(file.id, new Uint8Array(await blobBytes(blob)))
      fileRecords.push({ ...rest, type: blob.type })
    }
  }

  return {
    manifest: {
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      scope,
      createdAt: Date.now(),
      appVersion,
      jobs,
      runs,
      artifacts,
      files: fileRecords,
    },
    artifactBytes,
    fileBytes,
  }
}

export interface BackupResult {
  bytes: Uint8Array
  fileName: string
  folders: number
  runs: number
}

/** Builds one ready-to-write backup archive. */
export async function createBackup(
  scope: BackupScope,
  appVersion: string,
  at: Date = new Date(),
  namePrefix?: string,
): Promise<BackupResult> {
  const snapshot = await collectBackup(scope, appVersion)
  return {
    bytes: zipBackup(snapshot),
    fileName: backupFileName(at, scope, namePrefix),
    folders: snapshot.manifest.jobs.filter((job) => job.kind === 'folder')
      .length,
    runs: snapshot.manifest.runs.length,
  }
}

/** True when there is nothing worth backing up yet. */
export async function hasBackableWork(): Promise<boolean> {
  const runs = await db.runs.toArray()
  if (runs.some((run) => run.jobId !== CURRENT_JOB_ID)) return true
  return (await db.jobs.where('kind').equals('folder').count()) > 0
}

/**
 * Merges a backup into the database. Existing records with the same id are
 * overwritten by the backup's copy; everything else is left alone, so this is
 * safe to run on a database that still holds work. The `current` workspace is
 * never written to.
 */
export async function restoreBackup(
  archive: Uint8Array,
): Promise<RestoreSummary> {
  const { manifest, artifactBytes, fileBytes } = unzipBackup(archive)
  let skipped = 0

  const jobs = manifest.jobs.filter((job) => {
    if (!hasId(job) || job.id === CURRENT_JOB_ID) {
      skipped += 1
      return false
    }
    return true
  })
  const jobIds = new Set(jobs.map((job) => job.id))

  const runs = manifest.runs.filter((run) => {
    if (!isRestorableRun(run) || !jobIds.has(run.jobId)) {
      skipped += 1
      return false
    }
    return true
  })
  const runIds = new Set(runs.map((run) => run.id))

  const artifacts: RunArtifact[] = []
  for (const record of manifest.artifacts) {
    if (!isRestorableArtifact(record) || !runIds.has(record.runId)) {
      skipped += 1
      continue
    }
    const { hasBytes, ...rest } = record
    const bytes = artifactBytes.get(record.id)
    // A record that claims bytes but has none is a truncated archive. Keeping
    // it would produce a crop that renders as nothing; it is dropped instead.
    if (hasBytes === true && bytes === undefined) {
      skipped += 1
      continue
    }
    artifacts.push(bytes === undefined ? rest : { ...rest, bytes })
  }

  const files = manifest.files.flatMap((record) => {
    const bytes = fileBytes.get(record.id)
    if (!hasId(record) || !jobIds.has(record.jobId) || bytes === undefined) {
      skipped += 1
      return []
    }
    const { type, ...rest } = record
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: type === '' ? 'application/pdf' : type,
    })
    return [{ ...rest, blob }]
  })

  await db.transaction(
    'rw',
    db.jobs,
    db.runs,
    db.runArtifacts,
    db.files,
    async () => {
      await db.jobs.bulkPut(jobs)
      await db.runs.bulkPut(runs)
      await db.runArtifacts.bulkPut(artifacts)
      if (files.length > 0) await db.files.bulkPut(files)
    },
  )

  return {
    scope: manifest.scope,
    createdAt: manifest.createdAt,
    folders: jobs.filter((job) => job.kind === 'folder').length,
    runs: runs.length,
    artifacts: artifacts.length,
    files: files.length,
    skipped,
  }
}
