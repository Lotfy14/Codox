// Read token usage for an experiment variant out of Claude Code's own session
// transcripts (~/.claude/projects/<slug>/*.jsonl).
//
//   node scripts/exp-tokens.mjs [variant...]
//
// Each variant runs in its own session, so a transcript that mentions the
// variant's path IS that run. Usage is summed per assistant message and
// de-duplicated by message id, because a transcript can replay the same message
// more than once (compaction, resume) and naive summing double-counts it.

import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const slug = process.cwd().replace(/[:\\/]/g, '-')
const projectDir = path.join(os.homedir(), '.claude', 'projects', slug)

export async function tokensByVariant(variants) {
  const out = new Map(variants.map((v) => [v, null]))

  let files
  try {
    files = (await readdir(projectDir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return out
  }

  for (const file of files) {
    const full = path.join(projectDir, file)
    let text
    try {
      text = await readFile(full, 'utf8')
    } catch {
      continue
    }

    // Cheap pre-filter: skip transcripts that never mention any variant.
    const hits = variants.filter((v) => text.includes(`_experiment/${v}/`) || text.includes(`_experiment\\${v}\\`))
    if (hits.length !== 1) continue // ambiguous or irrelevant transcript
    const variant = hits[0]

    const seen = new Set()
    const sum = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 }
    let first = null
    let last = null
    // A variant session opens with the /convert command, so the first user
    // message to the last assistant message is the run itself — without the
    // window-switching and /config time the exp-start stamp picks up.
    let firstPrompt = null
    let lastAssistant = null
    // Which model actually served the run, and whether thinking was on. Both are
    // independent variables in the experiment, so read them back rather than
    // trusting that the session was configured as intended.
    const models = new Map()
    let thinkingBlocks = 0

    for (const line of text.split('\n')) {
      if (!line) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.timestamp) {
        if (!first || o.timestamp < first) first = o.timestamp
        if (!last || o.timestamp > last) last = o.timestamp
        if (o.type === 'user' && !firstPrompt) firstPrompt = o.timestamp
        if (o.type === 'assistant') lastAssistant = o.timestamp
      }
      if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (b.type === 'thinking' || b.type === 'redacted_thinking') thinkingBlocks += 1
        }
      }

      const u = o.message?.usage
      if (!u) continue
      if (o.message?.model) models.set(o.message.model, (models.get(o.message.model) ?? 0) + 1)
      const id = o.message?.id ?? o.uuid
      if (id && seen.has(id)) continue
      if (id) seen.add(id)

      sum.input += u.input_tokens ?? 0
      sum.output += u.output_tokens ?? 0
      sum.cacheWrite += u.cache_creation_input_tokens ?? 0
      sum.cacheRead += u.cache_read_input_tokens ?? 0
      sum.messages += 1
    }

    // Keep the largest transcript for a variant — a re-run leaves the earlier,
    // shorter session behind and the real run is the substantial one.
    const prev = out.get(variant)
    const runMinutes =
      firstPrompt && lastAssistant ? (new Date(lastAssistant) - new Date(firstPrompt)) / 60000 : null

    // Report the model that served the most messages; a session can carry a
    // stray call from another (title generation, a fallback).
    const model = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?'

    if (!prev || sum.output > prev.output) {
      out.set(variant, { ...sum, session: file.slice(0, 8), first, last, runMinutes, model, thinkingBlocks })
    }
  }

  return out
}

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const variants = process.argv.slice(2)
  if (variants.length === 0) {
    console.error('usage: node scripts/exp-tokens.mjs <variant> [variant...]')
    process.exit(1)
  }
  const table = await tokensByVariant(variants)
  console.log(`transcripts: ${projectDir}\n`)
  console.log('variant              session   msgs    output    input  cache-w   cache-r')
  console.log('-'.repeat(76))
  for (const [variant, t] of table) {
    if (!t) {
      console.log(`${variant.padEnd(20)}  (no transcript found)`)
      continue
    }
    console.log(
      `${variant.padEnd(20)}${t.session.padStart(8)}${String(t.messages).padStart(7)}` +
        `${k(t.output).padStart(10)}${k(t.input).padStart(9)}${k(t.cacheWrite).padStart(9)}${k(t.cacheRead).padStart(10)}`,
    )
  }
  console.log(`
output = the number that moves with thinking/effort (thinking tokens bill as output).
cache-r is cheap and cache-w ~1.25x input; compare variants on output first.
`)
}
