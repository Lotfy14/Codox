/**
 * Regenerates a workflow's big prompt constants in
 * `workflows/<Mineral>/engine/prompts.ts` from the ```text blocks in
 * `workflows/<Mineral>/PROMPTS.md`, which is that workflow's source of truth.
 *
 * Prompts belong to the workflow that runs them — a mineral may keep three
 * generated prompts, or one, or none. This script knows Gold's shape
 * (PLANNER / WORKER / AUDIT); a workflow with different roles edits ROLES.
 *
 * Run this after ANY edit to PROMPTS.md. `engine/prompts.test.ts` fails when
 * the doc and the constants disagree, which is exactly the "edited the doc,
 * forgot to regenerate" case — the app would otherwise keep running the old
 * prompt in silence.
 *
 * Usage: node scripts/sync-workflow-prompts.mjs [Mineral]   (default: Gold)
 */
import { readFileSync, writeFileSync } from 'node:fs'

const workflow = process.argv[2] ?? 'Gold'
const DOC = `workflows/${workflow}/PROMPTS.md`
const PROMPTS = `workflows/${workflow}/engine/prompts.ts`

/** Generated prompts, in the order their blocks appear in PROMPTS.md. */
const ROLES = ['PLANNER_PROMPT', 'WORKER_PROMPT', 'AUDIT_PROMPT']

const doc = readFileSync(DOC, 'utf8')
const blocks = [...doc.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((m) =>
  m[1].replace(/\r\n/g, '\n'),
)
if (blocks.length !== ROLES.length) {
  throw new Error(
    `${DOC}: expected exactly ${ROLES.length} prompt blocks, found ${blocks.length}`,
  )
}

let source = readFileSync(PROMPTS, 'utf8')

/** Replace `export const NAME: string = "..."` with the doc's text. */
function setConstant(name, text) {
  const marker = `export const ${name}: string = `
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`constant not found in ${PROMPTS}: ${name}`)
  const valueStart = start + marker.length
  if (source[valueStart] !== '"') throw new Error(`${name} is not a plain string literal`)
  // Walk the literal honouring backslash escapes.
  let i = valueStart + 1
  while (i < source.length) {
    if (source[i] === '\\') i += 2
    else if (source[i] === '"') break
    else i += 1
  }
  source = source.slice(0, valueStart) + JSON.stringify(text) + source.slice(i + 1)
}

ROLES.forEach((name, index) => setConstant(name, blocks[index]))
writeFileSync(PROMPTS, source)

console.log(`${workflow}: regenerated ${ROLES.length} prompts from ${DOC}`)
for (const [i, name] of ROLES.entries()) {
  console.log(`  ${name.padEnd(16)} ${blocks[i].length} chars`)
}
