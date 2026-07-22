/**
 * Folders (owner-approved 2026-07-22): a persistent, named job you add PDFs
 * to, convert inside, share one topic list across, and export as a whole.
 *
 * A folder is just a `JobState` with `kind: 'folder'` and a `name`, so the
 * whole conversion stack — `useConversion(jobId)`, `useJobPdfs(jobId)`, the
 * executor, resume, and the multi-run exporter — already works on it
 * unchanged. This module owns only the folder-specific lifecycle the
 * ephemeral `current` workspace does not have: create/rename/delete, add and
 * remove member PDFs, and folder-wide topic matching. Nothing here touches
 * the pinned engine path.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { getArtifact } from './runs'
import { clearTopicMatches, rematchRunTopics } from '../engine/topic-matcher'
import type { JobState, RunState, StoredPdf } from './types'

export function isFolderId(id: string): boolean {
  return id.startsWith('folder-')
}

export async function createFolder(name: string): Promise<string> {
  const id = `folder-${Date.now()}-${crypto.randomUUID()}`
  const folder: JobState = {
    id,
    createdAt: Date.now(),
    step: 'setup',
    kind: 'folder',
    name: name.trim() === '' ? 'Untitled folder' : name.trim(),
    keepOriginal: true,
  }
  await db.jobs.add(folder)
  return id
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed === '') return
  await db.jobs.update(id, { name: trimmed })
}

/** Deletes a folder and everything under it: runs, artifacts, and PDFs. */
export async function deleteFolder(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.jobs,
    db.files,
    db.runs,
    db.runArtifacts,
    async () => {
      const runs = await db.runs.where('jobId').equals(id).toArray()
      for (const run of runs) {
        const artifacts = await db.runArtifacts
          .where('runId')
          .equals(run.id)
          .toArray()
        await db.runArtifacts.bulkDelete(artifacts.map((a) => a.id))
      }
      await db.runs.bulkDelete(runs.map((run) => run.id))
      await db.files.where('jobId').equals(id).delete()
      await db.jobs.delete(id)
    },
  )
}

/**
 * Removes one member PDF from a folder along with its run, that run's
 * artifacts, and the stored file. A PDF that was never converted just loses
 * its file row.
 */
export async function removeFolderPdf(pdfId: string): Promise<void> {
  await db.transaction(
    'rw',
    db.files,
    db.runs,
    db.runArtifacts,
    async () => {
      const runs = await db.runs.where('pdfId').equals(pdfId).toArray()
      for (const run of runs) {
        const artifacts = await db.runArtifacts
          .where('runId')
          .equals(run.id)
          .toArray()
        await db.runArtifacts.bulkDelete(artifacts.map((a) => a.id))
      }
      await db.runs.bulkDelete(runs.map((run) => run.id))
      await db.files.delete(pdfId)
      // Drop the answer key linked to this exam, if any, so it never orphans.
      const keys = await db.files
        .filter((file) => file.parentPdfId === pdfId)
        .toArray()
      await db.files.bulkDelete(keys.map((file) => file.id))
    },
  )
}

/** Live list of every folder, newest first. undefined while loading. */
export function useFolders(): JobState[] | undefined {
  return useLiveQuery(async () => {
    const folders = await db.jobs.where('kind').equals('folder').toArray()
    return folders.sort((a, b) => b.createdAt - a.createdAt)
  }, [])
}

export function useFolder(id: string): JobState | undefined {
  return useLiveQuery(() => db.jobs.get(id), [id])
}

/** Toggle whether a PDF's run is included in the folder's shared matching. */
export async function setRunTopicExclusion(
  runId: string,
  excluded: boolean,
): Promise<void> {
  await db.runs.update(runId, {
    excludeFromTopicMatch: excluded,
    updatedAt: Date.now(),
  })
}

/** Drops a run's whole topic taxonomy so it exports with no topic columns. */
async function clearRunTopics(runId: string): Promise<void> {
  const list = await getArtifact(runId, 'topics-list')
  if (list !== undefined) await db.runArtifacts.delete(list.id)
  await clearTopicMatches(runId)
}

export interface FolderMatchOutcome {
  matched: number
  total: number
  failure?: string
}

/**
 * Applies the folder's one shared topic list to every finished member PDF,
 * skipping those the tutor excluded (their topics are cleared so they ship
 * blank topic columns). Reuses the post-run `rematchRunTopics` path, so it
 * stays outside the engine and NEVER-GUESS holds — an unsure row stays blank.
 */
export async function matchFolderTopics(
  folderId: string,
  options: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<FolderMatchOutcome> {
  const folder = await db.jobs.get(folderId)
  const topics = folder?.topics ?? []
  const runs = await db.runs.where('jobId').equals(folderId).toArray()
  const done = runs.filter((run) => run.status === 'done')

  for (const run of done.filter((run) => run.excludeFromTopicMatch === true)) {
    await clearRunTopics(run.id)
  }

  const targets = done.filter((run) => run.excludeFromTopicMatch !== true)
  let completed = 0
  for (const run of targets) {
    if (options.signal?.aborted) break
    const outcome = await rematchRunTopics(run.id, topics, {
      signal: options.signal,
    })
    completed += 1
    options.onProgress?.(completed, targets.length)
    if (!outcome.ok && outcome.failure.kind !== 'aborted') {
      return { matched: completed, total: targets.length, failure: outcome.failure.kind }
    }
  }
  return { matched: completed, total: targets.length }
}

/** The run that converted a given member PDF, if any. */
export function runForPdf(
  runs: readonly RunState[],
  pdf: StoredPdf,
): RunState | undefined {
  return runs.find((run) => run.pdfId === pdf.id)
}
