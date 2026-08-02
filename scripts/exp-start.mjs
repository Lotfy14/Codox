// Stamp the start of one experiment run. Run this immediately before /convert.
//
//   node scripts/exp-start.mjs <variant>
//
// The end time is taken from exam.json's mtime — the converting agent's last
// write — so neither you nor the agent has to watch a clock. Anything that
// touches exam.json after the run finishes will inflate the duration, so grade
// before editing.

import { writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const [variant] = process.argv.slice(2)

if (!variant) {
  console.error('usage: node scripts/exp-start.mjs <variant>')
  process.exit(1)
}

const variantDir = path.resolve('agent-conversion/output/_experiment', variant)

let examDirs
try {
  examDirs = (await readdir(variantDir, { withFileTypes: true })).filter((e) => e.isDirectory())
} catch {
  console.error(`no such variant: ${path.relative(process.cwd(), variantDir)}`)
  console.error('run scripts/exp-setup.mjs first')
  process.exit(1)
}

const startedAt = new Date().toISOString()

for (const dir of examDirs) {
  const examDir = path.join(variantDir, dir.name)
  const examJson = path.join(examDir, 'exam.json')

  const existing = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(examJson, 'utf8')))
  if ((existing.questions?.length ?? 0) > 0) {
    console.error(`refusing to start: ${dir.name} already has ${existing.questions.length} questions`)
    console.error('re-run scripts/exp-setup.mjs to reset this variant')
    process.exit(1)
  }

  await writeFile(path.join(examDir, '_run.json'), `${JSON.stringify({ variant, startedAt }, null, 2)}\n`)
  // Keep exam.json's mtime behind startedAt so a run that writes nothing reads
  // as zero-length rather than negative.
  await stat(examJson)
}

console.log(`started ${variant} at ${startedAt}

Now run, in THIS session:
  /convert agent-conversion/output/_experiment/${variant}/${examDirs[0].name}
`)
