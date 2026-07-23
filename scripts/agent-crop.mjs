/**
 * Step 2 of the agent-conversion loop: cut a figure out of a rendered page —
 * and let the agent LOOK at the result before accepting it.
 *
 * This is the whole reason an agent beats the engine at figures: the engine
 * emits one box and ships whatever it cut, while an agent can crop, open the
 * image, see that a label is clipped, and try again. Same script both times,
 * so what was checked is exactly what ships.
 *
 * Boxes use the pinned convention (CODOX_MIGRATION §1.8, src/engine/boxes.ts):
 * `[ymin, xmin, ymax, xmax]`, normalized 0–1000 against the rendered page.
 * y comes FIRST — an x/y swap makes a plausible-looking wrong crop.
 *
 * Usage:
 *   node scripts/agent-crop.mjs <exam-dir> <page> <ymin> <xmin> <ymax> <xmax> \
 *        [--out images/fig-01.jpg]
 *
 * `<page>` is 1-based and must be a page listed in that exam's exam.json.
 * Without --out the crop lands in `preview/` — a scratch look, not a figure
 * the manifest can reference.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

const { values, positionals } = parseArgs({
  options: {
    out: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
})

if (values.help || positionals.length < 6) {
  console.log(`
Crop a figure out of a rendered page, then look at it.

  node scripts/agent-crop.mjs <exam-dir> <page> <ymin> <xmin> <ymax> <xmax> [--out images/fig-01.jpg]

  <page>            1-based page number from that exam's exam.json
  ymin xmin ymax xmax   0-1000 normalized, y FIRST
  -o, --out <path>  Where to write it, relative to <exam-dir>.
                    Default: preview/crop.jpg (a look, not a shipped figure)
`)
  process.exit(positionals.length < 6 ? 1 : 0)
}

const examDir = path.resolve(positionals[0])
const pageNumber = Number(positionals[1])
const box = positionals.slice(2, 6).map(Number)

if (box.some((n) => !Number.isFinite(n))) {
  console.error('Every box value must be a number: ymin xmin ymax xmax')
  process.exit(1)
}
const [ymin, xmin, ymax, xmax] = box
if (ymax <= ymin || xmax <= xmin) {
  console.error(
    `Degenerate box [${box.join(', ')}] — ymax must exceed ymin and xmax must exceed xmin. ` +
      'Remember the order is [ymin, xmin, ymax, xmax].',
  )
  process.exit(1)
}
if (box.some((n) => n < 0 || n > 1000)) {
  console.error(`Box values are 0-1000 normalized; [${box.join(', ')}] is out of range.`)
  process.exit(1)
}

const manifest = JSON.parse(
  await readFile(path.join(examDir, 'exam.json'), 'utf8'),
)
const page = (manifest.pages ?? []).find((entry) => entry.index === pageNumber - 1)
if (page === undefined) {
  console.error(
    `Page ${pageNumber} is not in ${path.join(examDir, 'exam.json')}. ` +
      `Available: 1-${(manifest.pages ?? []).length}`,
  )
  process.exit(1)
}

// The same maths as boxToCropBox + clampCropBox in the app: pure scaling onto
// the page's pixel grid, then clamped to the page. Never "adjusted" otherwise.
const left = Math.round((xmin / 1000) * page.width)
const top = Math.round((ymin / 1000) * page.height)
const width = Math.max(1, Math.min(page.width - left, Math.round(((xmax - xmin) / 1000) * page.width)))
const height = Math.max(1, Math.min(page.height - top, Math.round(((ymax - ymin) / 1000) * page.height)))

const outRelative = values.out ?? 'preview/crop.jpg'
if (!/\.jpe?g$/i.test(outRelative)) {
  console.error(`--out must end in .jpg — bundle images ship as JPEG (got "${outRelative}")`)
  process.exit(1)
}
const outPath = path.join(examDir, outRelative)
await mkdir(path.dirname(outPath), { recursive: true })

const source = await readFile(path.join(examDir, page.file))
const cropped = await sharp(source)
  .extract({ left, top, width, height })
  .jpeg({ quality: 85 })
  .toBuffer()
await writeFile(outPath, cropped)

console.log(`wrote ${outPath}`)
console.log(`  page ${pageNumber} (${page.width}x${page.height}) → ${width}x${height} at ${left},${top}`)
console.log(`
Now OPEN that image and check it: is the whole figure inside, with its label
and any lettering, and nothing from the neighbouring question? If not, widen
the box and run this again. Only reference it from exam.json once it looks
right.`)
