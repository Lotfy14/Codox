/**
 * Export orchestration: read each finished run's rows + the tutor's
 * confirmed answers out of IndexedDB, compose the final CSVs
 * deterministically, zip the bundles, and hand the zip to the platform —
 * native share sheet in the Android shell, `navigator.share` on phones,
 * a Save-As picker on desktop (`browser-fs-access` falls back to a plain
 * download where the picker API is missing).
 *
 * Export-early law: a successful hand-off stamps `exportedAt` on every
 * exported run; a cancelled share sheet or save dialog does not.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { fileSave } from 'browser-fs-access'

interface FileSaverPlugin {
  saveToDownloads(options: { path: string; fileName: string }): Promise<void>
}
const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver')
import {
  applyTopicMatches,
  readRunTopics,
  readTopicMatches,
} from '../engine/topic-matcher'
import type { MergedRow } from '../engine/types'
import { bytesToBase64 } from '../providers/base64'
import { getArtifact, getArtifacts, updateRun } from '../state/runs'
import type { RunState } from '../state/types'
import {
  applyResolutions,
  getResolutions,
  isFlagged,
} from '../screens/review-data'
import {
  applyContentEdits,
  applyMetaEdits,
  editsSetTopic,
  editsSetYear,
  getEdits,
} from '../screens/review-edits'
import {
  applyDeletions,
  getAdditions,
  getDeletions,
} from '../screens/review-mutations'
import { emitExportCsv, exportColumns } from './export-csv'
import {
  assembleBundleFiles,
  exportArchiveName,
  uniqueBundleNames,
  zipBundles,
  type BundleInput,
} from './bundle'

/**
 * `saved` — the user picked a location in a Save-As dialog.
 * `downloaded` — no dialog was possible; the browser dropped the zip into
 * its Downloads folder, so the UI must say where it went.
 */
export type ExportOutcome =
  | 'shared'
  | 'saved'
  | 'downloaded'
  | 'cancelled'
  | 'nothing'

/** Runs that have a bundle to export: finished, rows persisted. */
export function exportableRuns(runs: readonly RunState[]): RunState[] {
  return runs.filter((run) => run.status === 'done')
}

/**
 * Where a prepared Triviadox upload gets imported. Export ships only the
 * questions the tutor has resolved (owner-approved 2026-07-21): a row still
 * flagged for review — no confirmed answer, or a structural flag like
 * not_mcq — is held back, and the UI warns with the count first. A run whose
 * answers are all blank (no answer key, nothing confirmed) therefore exports
 * nothing until the tutor answers them.
 */
export function triviadoxImportUrl(id: string): string {
  return `${triviadoxOrigin()}/management/import?id=${id}`
}

function triviadoxOrigin(): string {
  return typeof window !== 'undefined' &&
    window.location.origin.includes('localhost')
    ? 'http://localhost:3000'
    : 'https://triviadox.com'
}

/**
 * The rows of one run as they stand in review: tutor-added rows appended,
 * deleted rows dropped, content edits applied, then the tutor's confirmed
 * answers resolved. `isFlagged` on a returned row therefore means "still
 * unresolved" — no confirmed answer or a structural flag left standing.
 * Tutor-added and deleted rows are handled here so edits, resolutions and
 * the projection treat them exactly like engine rows; deletion is reversible
 * upstream, here it simply omits.
 */
async function reviewedRows(runId: string): Promise<MergedRow[]> {
  const merged = await getArtifact(runId, 'merged-rows')
  if (!Array.isArray(merged?.json)) {
    throw new Error(`Finished run ${runId} has no merged rows`)
  }
  const rows = applyDeletions(
    [...(merged.json as MergedRow[]), ...(await getAdditions(runId))],
    new Set(await getDeletions(runId)),
  )
  // Content edits (question/options/pictures/answer override) go first so
  // resolutions validate against the options the tutor actually saw.
  const edited = applyContentEdits(rows, await getEdits(runId))
  return applyResolutions(edited, await getResolutions(runId))
}

/**
 * How many rows would be held back from export because they still need
 * review (owner-approved 2026-07-21). The export UI shows this count and
 * asks the tutor to confirm before shipping the rest.
 */
export async function countUnexportedFlagged(
  runs: readonly RunState[],
): Promise<number> {
  let total = 0
  for (const run of exportableRuns(runs)) {
    total += (await reviewedRows(run.id)).filter(isFlagged).length
  }
  return total
}

async function buildBundleInputs(
  runs: readonly RunState[],
): Promise<BundleInput[]> {
  const names = uniqueBundleNames(runs.map((run) => run.fileName))
  const bundles: BundleInput[] = []
  for (const [index, run] of runs.entries()) {
    const resolved = await reviewedRows(run.id)
    // Only resolved rows ship (owner-approved 2026-07-21): a row still
    // flagged for review is held back rather than exported blank or broken.
    // The tutor was warned of the count before this ran.
    const edits = await getEdits(run.id)
    let projected = resolved.filter((row) => !isFlagged(row))
    // Column projection (owner-approved 2026-07-14): topics come only from
    // the run's snapshot + matches (blank when matching didn't finish —
    // export never waits); year per the run's snapshot; id/group_id never.
    // A tutor's explicit topic/subtopic/year edit also counts: it forces
    // its column and, applied last, wins over the matcher and the run's
    // year mode. Planner heading text still never reaches the CSV — with
    // no topic list the baseline under an edit is blank, not the planner's.
    const hasTopics = (await readRunTopics(run.id)) !== undefined
    if (hasTopics || editsSetTopic(edits)) {
      projected = applyTopicMatches(
        projected,
        hasTopics ? await readTopicMatches(run.id) : undefined,
      )
    }
    const typedYear = run.yearMode === 'type' ? (run.typedYear ?? '') : ''
    if (typedYear !== '') {
      projected = projected.map((row) => ({ ...row, year: typedYear }))
    } else if (run.yearMode !== 'ai' && editsSetYear(edits)) {
      projected = projected.map((row) => ({ ...row, year: '' }))
    }
    projected = applyMetaEdits(projected, edits)
    const csvText = emitExportCsv(
      projected,
      exportColumns({
        topics: hasTopics || editsSetTopic(edits),
        year: run.yearMode === 'ai' || typedYear !== '' || editsSetYear(edits),
      }),
    )
    const crops = (await getArtifacts(run.id, 'crop')).flatMap((crop) =>
      crop.path !== undefined && crop.bytes !== undefined
        ? [{ path: crop.path, bytes: crop.bytes }]
        : [],
    )
    bundles.push({ name: names[index], csvText, crops })
  }
  return bundles
}

/** True on devices where the share sheet is the natural "save this". */
function preferShareSheet(): boolean {
  // iOS (iPhone/iPad) browsers prefer the native share sheet for file exports.
  // Android browsers have a robust download manager and prefer standard downloads.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && navigator.userAgent.includes('Macintosh'))
  );
}

async function deliverZip(
  bytes: Uint8Array,
  fileName: string,
): Promise<ExportOutcome> {
  // Inside the .apk: write to the app cache, then the native share sheet.
  // The Capacitor plugins load lazily so the web bundle never pays for them.
  if (Capacitor.isNativePlatform()) {
    const [{ Directory, Filesystem }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const written = await Filesystem.writeFile({
      path: fileName,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
    })
    if (Capacitor.getPlatform() === 'android') {
      try {
        await FileSaver.saveToDownloads({
          path: written.uri,
          fileName,
        })
        return 'downloaded'
      } catch (error) {
        console.error('FileSaver failed, falling back to Share sheet:', error)
      }
    }
    try {
      await Share.share({ files: [written.uri] })
      return 'shared'
    } catch {
      // The plugin rejects when the user dismisses the sheet.
      return 'cancelled'
    }
  }

  const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: 'application/zip',
  })
  // Files-only payload — adding title/text breaks file sharing on iOS.
  const payload: ShareData = { files: [file] }
  if (
    preferShareSheet() &&
    navigator.canShare?.(payload) === true &&
    navigator.share !== undefined
  ) {
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled'
      }
      // Share failed for a non-cancel reason — fall through to the save
      // path so the export never silently dies.
    }
  }
  try {
    const handle = await fileSave(file, {
      fileName,
      extensions: ['.zip'],
    })
    // A handle means the Save-As picker ran; null means the legacy
    // anchor-download fallback fired (Firefox/Safari).
    return handle === null ? 'downloaded' : 'saved'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled'
    }
    throw error
  }
}

/**
 * Export every finished run as one zip of namespaced bundles
 * (one PDF-derived `Cx` folder and CSV per run, plus `images/`).
 */
export async function exportRuns(
  runs: readonly RunState[],
): Promise<ExportOutcome> {
  const exportable = exportableRuns(runs)
  if (exportable.length === 0) return 'nothing'
  const bundles = await buildBundleInputs(exportable)
  const zipped = zipBundles(assembleBundleFiles(bundles))
  const fileName = exportArchiveName(
    exportable.map((run) => run.fileName),
  )
  const outcome = await deliverZip(zipped, fileName)
  if (outcome === 'shared' || outcome === 'saved' || outcome === 'downloaded') {
    const stamp = Date.now()
    for (const run of exportable) {
      await updateRun(run.id, { exportedAt: stamp })
    }
  }
  return outcome
}

/**
 * Serializes the finalized run data (CSV + base64 crop images) and uploads it
 * to the temporary preparation endpoint on Triviadox.
 */
export async function exportToTriviadox(
  runs: readonly RunState[],
): Promise<{ success: boolean; id?: string; error?: string }> {
  const exportable = exportableRuns(runs)
  if (exportable.length === 0) return { success: false, error: 'nothing' }

  const bundles = await buildBundleInputs(exportable)
  const payload = {
    bundles: bundles.map((b) => ({
      name: b.name,
      csvText: b.csvText,
      crops: b.crops.map((c) => ({
        name: c.path,
        base64: bytesToBase64(c.bytes),
      })),
    })),
  }

  try {
    const res = await fetch(`${triviadoxOrigin()}/api/import/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}))
      return { success: false, error: errJson.error || `HTTP error ${res.status}` }
    }

    const json = await res.json()
    if (!json.id) {
      return { success: false, error: 'No ID returned from server' }
    }

    const stamp = Date.now()
    for (const run of exportable) {
      await updateRun(run.id, { exportedAt: stamp })
    }

    return { success: true, id: json.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' }
  }
}

