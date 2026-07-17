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
import { Capacitor } from '@capacitor/core'
import { fileSave } from 'browser-fs-access'
import { applyAiAnswers, readAiAnswers } from '../engine/solver'
import {
  applyTopicMatches,
  readRunTopics,
  readTopicMatches,
} from '../engine/topic-matcher'
import type { MergedRow } from '../engine/types'
import { getAiAnswerSettings } from '../state/ai-answers-settings'
import { bytesToBase64 } from '../providers/base64'
import { getArtifact, getArtifacts, updateRun } from '../state/runs'
import type { RunState } from '../state/types'
import { applyResolutions, getResolutions } from '../screens/review-data'
import {
  applyContentEdits,
  applyMetaEdits,
  editsSetTopic,
  editsSetYear,
  getEdits,
} from '../screens/review-edits'
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

/**
 * What the exported CSVs carry in `correct_index`:
 * - `with-answers` — the default: document answers + tutor resolutions.
 * - `no-answers` — every `correct_index` blanked (a practice set); flags
 *   are untouched. Deterministic, no model involved.
 * - `ai-answers` — the run's saved AI answers applied per the user's AI
 *   settings. The exporter only APPLIES the saved artifact — solving
 *   happened before export, and `merged-rows` itself is never modified.
 */
export type ExportMode = 'with-answers' | 'no-answers' | 'ai-answers'

export interface ExportOptions {
  mode?: ExportMode
}

/** The zip-name suffix marking variant exports; folder names stay §3.4. */
const VARIANT_SUFFIX: Record<ExportMode, string | undefined> = {
  'with-answers': undefined,
  'no-answers': 'no answers',
  'ai-answers': 'AI answers',
}

/** Runs that have a bundle to export: finished, rows persisted. */
export function exportableRuns(runs: readonly RunState[]): RunState[] {
  return runs.filter((run) => run.status === 'done')
}

async function rowsForMode(
  run: RunState,
  rows: MergedRow[],
  mode: ExportMode,
): Promise<MergedRow[]> {
  if (mode === 'no-answers') {
    return rows.map((row) => ({ ...row, correct_index: '' }))
  }
  if (mode === 'ai-answers') {
    return applyAiAnswers(
      rows,
      await readAiAnswers(run.id),
      await getAiAnswerSettings(),
    )
  }
  return rows
}

async function buildBundleInputs(
  runs: readonly RunState[],
  mode: ExportMode,
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
    const edits = await getEdits(run.id)
    // Content edits (question/options/pictures/answer override) go first
    // so resolutions validate against the options the tutor actually saw.
    const edited = applyContentEdits(rows, edits)
    const resolved = applyResolutions(edited, resolutions)
    let projected = await rowsForMode(run, resolved, mode)
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
  options: ExportOptions = {},
): Promise<ExportOutcome> {
  const mode = options.mode ?? 'with-answers'
  const exportable = exportableRuns(runs)
  if (exportable.length === 0) return 'nothing'
  const bundles = await buildBundleInputs(exportable, mode)
  const zipped = zipBundles(assembleBundleFiles(bundles))
  const fileName = exportArchiveName(
    exportable.map((run) => run.fileName),
    VARIANT_SUFFIX[mode],
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
