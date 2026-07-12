/**
 * Dev-only CSV download. Phase 6 ends at validated rows + `questions.csv`
 * content persisted in IndexedDB; the real Export bundle (zip + images/)
 * is Phase 7. This exists so a finished run can be handed to the
 * CodoxSandbox grader before the Export screen exists.
 */
import { getArtifact } from '../state/runs'
import type { RunState } from '../state/types'

/** `exam.pdf` → `exam.csv` (the bundle names it questions.csv in Phase 7). */
function csvFileName(fileName: string): string {
  return `${fileName.replace(/\.pdf$/i, '')}.csv`
}

export async function downloadRunCsv(run: RunState): Promise<void> {
  const artifact = await getArtifact(run.id, 'csv')
  if (artifact?.text === undefined) return

  // UTF-8 with a BOM: the contract is BOM-tolerant on read (§3.2), and a
  // BOM is what makes Excel open Arabic headers correctly on Windows.
  const blob = new Blob(['﻿', artifact.text], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = csvFileName(run.fileName)
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
