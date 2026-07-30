/**
 * Automatic backups into a folder the tutor picks once.
 *
 * A manual "save a backup" button only helps the tutors who remember to press
 * it, and the ones who lose a week of work are exactly the ones who did not.
 * So Codox writes a fresh backup into a chosen folder on its own: after every
 * batch of conversions, and at launch when the newest backup there is stale.
 *
 * This uses the File System Access API, which is the only way a web app can
 * write to the same file repeatedly without a save dialog each time. It is
 * feature-detected, never platform-detected (no `if (android)` anywhere —
 * CLAUDE.md): where `showDirectoryPicker` is missing the panel says so and the
 * manual backup button is the whole feature. The picked handle lives in
 * IndexedDB because that is the only store handles survive in.
 *
 * Scope is always 'work' — small enough to write unattended. Automatic files
 * carry their own name prefix and only those are pruned, so a backup the tutor
 * saved by hand into the same folder is never deleted by this module.
 */
import { createBackup, isBackupFileName } from './backup'
import { db } from './db'

const HANDLE_KEY = 'auto-backup-folder'
const LAST_RUN_KEY = 'autoBackupLastAt'
const AUTO_PREFIX = 'Codox auto-backup'
/** Newest N automatic backups kept; older ones are pruned after each write. */
const KEEP_COPIES = 5
/** At launch, only back up when the last automatic one is older than this. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000

/**
 * The permission bits of the File System Access API are not in lib.dom, so
 * the two calls this module needs are declared here rather than cast at each
 * use site.
 */
type PermissionState = 'granted' | 'denied' | 'prompt'
interface PermissionCapableHandle extends FileSystemDirectoryHandle {
  queryPermission?: (options: {
    mode: 'read' | 'readwrite'
  }) => Promise<PermissionState>
  requestPermission?: (options: {
    mode: 'read' | 'readwrite'
  }) => Promise<PermissionState>
}

/** True where a folder can be picked and written to without a dialog. */
export function supportsAutoBackup(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/**
 * Whether a backup is owed. A finished batch always is — work just changed.
 * A launch is only owed one when the newest automatic backup has gone stale,
 * so opening the app ten times in an afternoon writes one file, not ten.
 */
export function isAutoBackupDue(
  reason: 'startup' | 'batch-finished',
  lastBackupAt: number | null,
  now: number,
): boolean {
  if (reason === 'batch-finished') return true
  return lastBackupAt === null || now - lastBackupAt >= STALE_AFTER_MS
}

/**
 * Which files in the folder should be deleted after a write. Only automatic
 * backups are candidates — a backup the tutor saved by hand into the same
 * folder is never pruned, whatever its age. The `YYYY-MM-DD HHmm` stamp makes
 * lexicographic order chronological order, so the oldest sort first.
 */
export function prunableBackups(
  names: readonly string[],
  keep = KEEP_COPIES,
): string[] {
  const automatic = names
    .filter((name) => name.startsWith(AUTO_PREFIX) && isBackupFileName(name))
    .sort()
  return automatic.slice(0, Math.max(0, automatic.length - keep))
}

export interface AutoBackupFolder {
  name: string
  /** 'prompt' means the handle survived a reload but needs a click to reuse. */
  permission: PermissionState
  lastBackupAt: number | null
}

async function storedHandle(): Promise<PermissionCapableHandle | null> {
  try {
    const entry = await db.handles.get(HANDLE_KEY)
    return (entry?.handle as PermissionCapableHandle | undefined) ?? null
  } catch {
    return null
  }
}

async function lastBackupAt(): Promise<number | null> {
  const entry = await db.meta.get(LAST_RUN_KEY)
  const value = Number(entry?.value)
  return Number.isFinite(value) && value > 0 ? value : null
}

async function permissionFor(
  handle: PermissionCapableHandle,
  request: boolean,
): Promise<PermissionState> {
  try {
    const current = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
    if (current === 'granted' || !request) return current
    // Only ever called straight out of a click: the browser rejects a
    // permission request that is not tied to a user gesture.
    return (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied'
  } catch {
    return 'denied'
  }
}

/** The configured folder, or null when automatic backup is off. */
export async function readAutoBackupFolder(): Promise<AutoBackupFolder | null> {
  const handle = await storedHandle()
  if (handle === null) return null
  return {
    name: handle.name,
    permission: await permissionFor(handle, false),
    lastBackupAt: await lastBackupAt(),
  }
}

/**
 * Opens the folder picker and stores the choice. Must be called from a click.
 * Returns null when the tutor dismissed the picker.
 */
export async function chooseAutoBackupFolder(): Promise<AutoBackupFolder | null> {
  if (!supportsAutoBackup()) return null
  const picker = (
    window as unknown as {
      showDirectoryPicker: (options?: {
        mode?: 'read' | 'readwrite'
        id?: string
      }) => Promise<PermissionCapableHandle>
    }
  ).showDirectoryPicker
  let handle: PermissionCapableHandle
  try {
    handle = await picker({ mode: 'readwrite', id: 'codox-backups' })
  } catch {
    return null // Dismissed, or blocked by the embedder.
  }
  await db.handles.put({ key: HANDLE_KEY, handle })
  return {
    name: handle.name,
    permission: await permissionFor(handle, true),
    lastBackupAt: await lastBackupAt(),
  }
}

/** Reconnects a folder whose permission lapsed across a reload (needs a click). */
export async function reconnectAutoBackupFolder(): Promise<AutoBackupFolder | null> {
  const handle = await storedHandle()
  if (handle === null) return null
  return {
    name: handle.name,
    permission: await permissionFor(handle, true),
    lastBackupAt: await lastBackupAt(),
  }
}

export async function clearAutoBackupFolder(): Promise<void> {
  await db.handles.delete(HANDLE_KEY)
}

export type AutoBackupOutcome =
  | { kind: 'written'; fileName: string; at: number }
  | { kind: 'not-configured' }
  | { kind: 'needs-permission' }
  | { kind: 'not-due' }
  | { kind: 'failed'; reason: string }

/**
 * Writes a backup into the configured folder.
 *
 * `reason: 'batch-finished'` always writes — work just changed. `'startup'`
 * writes only when the newest automatic backup is stale, so opening the app
 * ten times in an afternoon does not produce ten files.
 */
export async function runAutoBackup(
  appVersion: string,
  reason: 'startup' | 'batch-finished',
  now: Date = new Date(),
): Promise<AutoBackupOutcome> {
  const handle = await storedHandle()
  if (handle === null) return { kind: 'not-configured' }
  if ((await permissionFor(handle, false)) !== 'granted') {
    return { kind: 'needs-permission' }
  }
  if (!isAutoBackupDue(reason, await lastBackupAt(), now.getTime())) {
    return { kind: 'not-due' }
  }

  try {
    const backup = await createBackup('work', appVersion, now, AUTO_PREFIX)
    const file = await handle.getFileHandle(backup.fileName, { create: true })
    const stream = await file.createWritable()
    await stream.write(backup.bytes as Uint8Array<ArrayBuffer>)
    await stream.close()
    await db.meta.put({ key: LAST_RUN_KEY, value: String(now.getTime()) })
    await pruneOldCopies(handle)
    return { kind: 'written', fileName: backup.fileName, at: now.getTime() }
  } catch (error) {
    return {
      kind: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Deletes everything `prunableBackups` names. A failure here is swallowed: the
 * backup itself already landed, and that is the part that matters.
 */
async function pruneOldCopies(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const names: string[] = []
    const entries = (
      handle as FileSystemDirectoryHandle & {
        values: () => AsyncIterable<FileSystemHandle>
      }
    ).values()
    for await (const entry of entries) {
      if (entry.kind === 'file') names.push(entry.name)
    }
    for (const name of prunableBackups(names)) await handle.removeEntry(name)
  } catch {
    // Pruning is housekeeping, never a reason to report a failed backup.
  }
}
