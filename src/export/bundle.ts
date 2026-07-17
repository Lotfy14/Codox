/**
 * Bundle assembly — pure and deterministic. The output contract (§3.4):
 * one `<pdf-name> Cx/` folder per PDF holding a matching CSV and a sibling
 * `images/` folder, zipped. Relative image
 * paths mean a bundle folder keeps working wherever it is moved.
 */
import { zipSync } from 'fflate'

/** `Exam (v2).pdf` → `Exam (v2)` with path-hostile characters removed. */
export function safeBundleName(fileName: string): string {
  const base = fileName
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return base === '' || !/[\p{L}\p{N}]/u.test(base) ? 'exam' : base
}

/** One folder per PDF, batch collisions namespaced `name`, `name-2`, … */
export function uniqueBundleNames(fileNames: readonly string[]): string[] {
  const taken = new Set<string>()
  return fileNames.map((fileName) => {
    const base = safeBundleName(fileName)
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base}-${n}`
    taken.add(name.toLowerCase())
    return name
  })
}

/**
 * Human-identifiable archive name derived from the PDFs in the export.
 * Bundle folder and CSV names inside stay contract-exact (§3.4).
 */
export function exportArchiveName(fileNames: readonly string[]): string {
  const names = uniqueBundleNames(fileNames)
  if (names.length === 0) return 'Codox export Cx.zip'
  if (names.length === 1) return `${names[0]} Cx.zip`
  return `${names[0]} +${names.length - 1} more Cx.zip`
}

export interface BundleInput {
  /** PDF-derived folder/file stem (already namespaced for batch collisions). */
  name: string
  /** The final CSV text (resolutions applied), without a BOM. */
  csvText: string
  /** Crop images: bundle-relative path (`images/asset01.jpg`) + bytes. */
  crops: ReadonlyArray<{ path: string; bytes: Uint8Array }>
}

/**
 * Lay the bundles out as zip entries. Each named CSV gets a UTF-8 BOM —
 * the contract is BOM-tolerant on read (§3.2) and the BOM is what makes
 * Excel open Arabic headers correctly on Windows.
 */
export function assembleBundleFiles(
  bundles: readonly BundleInput[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const bom = String.fromCharCode(0xfeff)
  for (const bundle of bundles) {
    const outputName = `${bundle.name} Cx`
    files[`${outputName}/${outputName}.csv`] = new TextEncoder().encode(
      bom + bundle.csvText,
    )
    for (const crop of bundle.crops) {
      files[`${outputName}/${crop.path}`] = crop.bytes
    }
  }
  return files
}

/** Zip the laid-out entries. JPEGs are stored, text is deflated. */
export function zipBundles(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, bytes] of Object.entries(files)) {
    entries[path] = [bytes, { level: path.endsWith('.jpg') ? 0 : 6 }]
  }
  // ponytail: zipSync on the main thread — bundles are CSV + a few ~35 KB
  // crops. Move to fflate's async zip() if bundles ever grow past a few MB.
  return zipSync(entries)
}
