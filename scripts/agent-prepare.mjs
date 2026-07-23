/**
 * Step 1 of the agent-conversion loop: turn a folder of exam PDFs into a
 * working bundle an agent can fill in.
 *
 * For each exam PDF it renders every page at the app's pinned 200 DPI (the
 * same renderer and the same scale the engine uses, so what the agent looks
 * at is what Codox will show the tutor), copies the PDF, and writes an
 * `exam.json` skeleton with `pages[]` already filled and `questions: []`
 * waiting.
 *
 * An answer key is matched to its exam by name (`<exam>-key.pdf`,
 * `<exam> key.pdf`, `<exam>-answers.pdf`, or anything inside a `keys/`
 * subfolder). Its pages are appended AFTER the exam's, which is the same
 * page-offset convention the engine's executor uses.
 *
 * Usage:
 *   node scripts/agent-prepare.mjs <input-folder> [--out <dir>] [--dpi 200]
 */
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'

/** Pinned by CODOX_MIGRATION's parameters table; mirrors src/pdf/pdfium.ts. */
const RENDER_DPI = 200
const PDF_POINTS_PER_INCH = 72
/** Mirrors PAGE_JPEG_QUALITY (0.8) in src/pdf/images.ts. */
const PAGE_QUALITY = 80

const { values, positionals } = parseArgs({
  options: {
    out: { type: 'string', short: 'o' },
    dpi: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
})

if (values.help || positionals.length === 0) {
  console.log(`
Prepare an agent-conversion bundle from a folder of exam PDFs.

  node scripts/agent-prepare.mjs <input-folder> [options]

  -o, --out <dir>   Where the bundle goes.
                    Default: agent-conversion/output/<input-folder-name>
      --dpi <n>     Render DPI. Default ${RENDER_DPI} (what the app uses).
`)
  process.exit(positionals.length === 0 ? 1 : 0)
}

const inputDir = path.resolve(positionals[0])
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const outDir = path.resolve(
  values.out ?? path.join(repoRoot, 'agent-conversion', 'output', path.basename(inputDir)),
)
const dpi = Number(values.dpi ?? RENDER_DPI)

/** `Exam (v2).pdf` → `exam-v2` — a folder name that survives every OS. */
function slugify(name) {
  return (
    name
      .replace(/\.pdf$/i, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'exam'
  )
}

/** Every PDF under the input folder, one level of subfolders included. */
async function collectPdfs(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const nested of await readdir(full, { withFileTypes: true })) {
        if (nested.isFile() && nested.name.toLowerCase().endsWith('.pdf')) {
          found.push({ file: path.join(full, nested.name), parent: entry.name })
        }
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      found.push({ file: full, parent: '' })
    }
  }
  return found
}

/** True when this PDF reads as an answer key rather than an exam. */
function looksLikeKey({ file, parent }) {
  const name = path.basename(file).toLowerCase()
  return (
    /(^|[-_ ])(key|keys|answers?|answer[-_ ]?key)\.pdf$/.test(name) ||
    /^(keys|answers)$/.test(parent.toLowerCase())
  )
}

/** The exam a key belongs to: longest shared stem wins, else the only exam. */
function keyOwner(key, exams) {
  const keyStem = slugify(path.basename(key.file)).replace(
    /-(key|keys|answers?|answer-key)$/,
    '',
  )
  const exact = exams.find((exam) => slugify(path.basename(exam.file)) === keyStem)
  if (exact !== undefined) return exact
  return exams.length === 1 ? exams[0] : undefined
}

async function renderPages(library, pdfPath, targetDir, startIndex, role) {
  const bytes = await readFile(pdfPath)
  const doc = await library.loadDocument(new Uint8Array(bytes))
  const pages = []
  try {
    for (let n = 0; n < doc.getPageCount(); n += 1) {
      const index = startIndex + n
      const file = `pages/page-${String(index + 1).padStart(3, '0')}.jpg`
      const page = doc.getPage(n)
      let width = 0
      let height = 0
      const rendered = await page.render({
        scale: dpi / PDF_POINTS_PER_INCH,
        render: (bitmap) => {
          width = bitmap.width
          height = bitmap.height
          return sharp(bitmap.data, {
            raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
          })
            .jpeg({ quality: PAGE_QUALITY })
            .toBuffer()
        },
      })
      await writeFile(path.join(targetDir, file), rendered.data)
      pages.push({ index, file, width, height, role })
      process.stdout.write(`  ${file} (${width}x${height})\n`)
    }
  } finally {
    doc.destroy()
  }
  return pages
}

const pdfs = await collectPdfs(inputDir)
if (pdfs.length === 0) {
  console.error(`No PDFs found in ${inputDir}`)
  process.exit(1)
}
const exams = pdfs.filter((pdf) => !looksLikeKey(pdf))
const keys = pdfs.filter(looksLikeKey)
if (exams.length === 0) {
  console.error(`Every PDF in ${inputDir} looks like an answer key.`)
  process.exit(1)
}

const library = await PDFiumLibrary.init()
try {
  for (const exam of exams) {
    const slug = slugify(path.basename(exam.file))
    const examDir = path.join(outDir, slug)
    await mkdir(path.join(examDir, 'pages'), { recursive: true })
    await mkdir(path.join(examDir, 'images'), { recursive: true })
    console.log(`\n${path.basename(exam.file)} → ${path.relative(repoRoot, examDir)}`)

    await copyFile(exam.file, path.join(examDir, 'exam.pdf'))
    const pages = await renderPages(library, exam.file, examDir, 0, 'exam')

    const key = keys.find((candidate) => keyOwner(candidate, exams) === exam)
    if (key !== undefined) {
      console.log(`  answer key: ${path.basename(key.file)}`)
      pages.push(
        ...(await renderPages(library, key.file, examDir, pages.length, 'answer-key')),
      )
    }

    await writeFile(
      path.join(examDir, 'exam.json'),
      `${JSON.stringify(
        {
          codoxAgentBundle: 1,
          sourceFile: path.basename(exam.file),
          producedBy: '',
          pages,
          figures: [],
          topics: [],
          questions: [],
        },
        null,
        2,
      )}\n`,
    )
  }
} finally {
  library.destroy()
}

console.log(`
Prepared ${exams.length} exam${exams.length === 1 ? '' : 's'} in ${path.relative(repoRoot, outDir)}

Next: follow agent-conversion/AGENTS.md — look at every page image, fill in
questions[], crop figures with scripts/agent-crop.mjs, then run
  node scripts/agent-validate.mjs "${path.relative(repoRoot, outDir)}"
until it reports no errors.`)
