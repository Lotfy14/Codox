/**
 * Step 3 of the agent-conversion loop: the gate.
 *
 * This runs the SAME validator the Codox importer runs
 * (`src/agent-import/manifest.ts`) — Node 24 executes that TypeScript
 * directly by stripping types, and the module is deliberately free of runtime
 * imports beyond the dependency-free `src/engine/boxes.ts`. One validator, so
 * a bundle that passes here cannot be rejected by the app.
 *
 * Errors mean the exam will not import. Warnings mean it will, with those
 * questions flagged for the tutor — read them, they are usually worth fixing.
 *
 * Usage:
 *   node scripts/agent-validate.mjs [batch-or-exam-dir]
 * Defaults to agent-conversion/output.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  EXAM_MANIFEST_NAME,
  validateAgentExam,
} from '../src/agent-import/manifest.ts'

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')),
  '..',
)
const target = path.resolve(
  process.argv[2] ?? path.join(repoRoot, 'agent-conversion', 'output'),
)

/** Every directory holding an exam.json, at any depth. */
async function findExamDirs(dir) {
  const found = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  if (entries.some((entry) => entry.isFile() && entry.name === EXAM_MANIFEST_NAME)) {
    found.push(dir)
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...(await findExamDirs(path.join(dir, entry.name))))
    }
  }
  return found
}

/** Bundle-relative paths of everything inside an exam folder. */
async function listFiles(dir, prefix = '') {
  const paths = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(path.join(dir, entry.name), relative)))
    } else {
      paths.push(relative)
    }
  }
  return paths
}

try {
  await stat(target)
} catch {
  console.error(`No such directory: ${target}`)
  process.exit(1)
}

const examDirs = await findExamDirs(target)
if (examDirs.length === 0) {
  console.error(`No ${EXAM_MANIFEST_NAME} found under ${target}`)
  process.exit(1)
}

let errorCount = 0
let warningCount = 0

for (const dir of examDirs) {
  const label = path.relative(repoRoot, dir) || dir
  let parsed
  try {
    parsed = JSON.parse(await readFile(path.join(dir, EXAM_MANIFEST_NAME), 'utf8'))
  } catch (error) {
    console.log(`\n✗ ${label}`)
    console.log(`  ${EXAM_MANIFEST_NAME} is not valid JSON: ${error.message}`)
    errorCount += 1
    continue
  }

  const files = new Set(await listFiles(dir))
  const result = validateAgentExam(parsed, files)

  if (!result.ok) {
    console.log(`\n✗ ${label}`)
    for (const error of result.errors) console.log(`  error: ${error}`)
    errorCount += result.errors.length
  } else {
    const { questions, figures, pages } = result.exam
    const extracted = questions.filter((q) => q.answer.source === 'extracted').length
    const reasoned = questions.filter((q) => q.answer.source === 'reasoned').length
    const blank = questions.length - extracted - reasoned
    console.log(`\n✓ ${label}`)
    console.log(
      `  ${questions.length} questions · ${pages.length} pages · ${figures.length} figures`,
    )
    console.log(
      `  answers: ${extracted} read from the document · ${reasoned} reasoned (tutor approves) · ${blank} blank`,
    )
    if (questions.length === 0) {
      console.log('  note: no questions yet — this bundle imports as an empty exam')
    }
  }
  for (const warning of result.warnings) console.log(`  warning: ${warning}`)
  warningCount += result.warnings.length
}

console.log(
  `\n${examDirs.length} exam${examDirs.length === 1 ? '' : 's'} checked · ` +
    `${errorCount} error${errorCount === 1 ? '' : 's'} · ` +
    `${warningCount} warning${warningCount === 1 ? '' : 's'}`,
)
if (errorCount > 0) {
  console.log('Fix the errors above — an exam with errors will not import.')
  process.exit(1)
}
