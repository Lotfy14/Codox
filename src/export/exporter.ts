/**
 * Export orchestration: read each finished run's rows + the tutor's
 * confirmed answers out of IndexedDB, compose the final CSVs
 * deterministically, zip the bundles, and hand the zip to the platform —
 * native share sheet in the Android shell, `navigator.share` on phones,
 * a plain download on desktop.
 *
 * Export-early law: a successful hand-off stamps `exportedAt` on every
 * exported run; a cancelled share sheet does not.
 */
import { Capacitor } from '@capacitor/core'
import { emitCsv } from '../engine/csv'
import type { MergedRow } from '../engine/types'
import { bytesToBase64 } from '../providers/base64'
import { getArtifact, getArtifacts, updateRun } from '../state/runs'
import type { RunState } from '../state/types'
import { applyResolutions, getResolutions } from '../screens/review-data'
import {
  assembleBundleFiles,
  exportArchiveName,
  uniqueBundleNames,
  zipBundles,
  type BundleInput,
} from './bundle'

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled' | 'nothing'

/** Runs that have a bundle to export: finished, rows persisted. */
export function exportableRuns(runs: readonly RunState[]): RunState[] {
  return runs.filter((run) => run.status === 'done')
}

async function buildBundleInputs(
  runs: readonly RunState[],
): Promise<BundleInput[]> {
  const names = uniqueBundleNames(runs.map((run) => run.fileName))
  const bundles: BundleInput[] = []
  for (const [index, run] of runs.entries()) {
    const merged = await getArtifact(run.id, 'merged-rows')
    if (!Array.isArray(merged?.json)) {
      throw new Error(`Finished run ${run.id} has no merged rows`)
    }
    const rows = merged.json as MergedRow[]
    const resolutions = await getResolutions(run.id)
    const csvText = emitCsv(applyResolutions(rows, resolutions))
    const crops = (await getArtifacts(run.id, 'crop')).flatMap((crop) =>
      crop.path !== undefined && crop.bytes !== undefined
        ? [{ path: crop.path, bytes: crop.bytes }]
        : [],
    )
    bundles.push({ name: names[index], csvText, crops })
  }
  return bundles
}

function downloadZip(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: 'application/zip',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** True on devices where the share sheet is the natural "save this". */
function preferShareSheet(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
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
      // Share failed for a non-cancel reason — fall through to download
      // so the export never silently dies.
    }
  }
  downloadZip(bytes, fileName)
  return 'downloaded'
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
  const fileName = exportArchiveName(exportable.map((run) => run.fileName))
  const outcome = await deliverZip(zipped, fileName)
  if (outcome === 'shared' || outcome === 'downloaded') {
    const stamp = Date.now()
    for (const run of exportable) {
      await updateRun(run.id, { exportedAt: stamp })
    }
  }
  return outcome
}
