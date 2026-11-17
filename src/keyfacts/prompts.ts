/**
 * Pure prompt building and reply parsing for the Key facts area.
 *
 * The SYSTEM prompts come from Triviadox inside each job (`payload.prompts`),
 * so they change without a Codox release. What lives here is the part that
 * must match code: the user message layout (ported from Triviadox's
 * `buildKeyFactBatchUserMessage`) and the reply parsers (ported from
 * `parseKeyFactBatchResponse` and the flashcard benchmark's card checks).
 * The model only returns JSON; this code decides what it means.
 */

/** Key-fact ids Codox gives its own new facts in prompts, far above any real id. */
export const NEW_FACT_ID_BASE = 1_000_000_000

export interface PromptQuestion {
  question: string
  options: string[]
  correctIndex: number
}

export interface PromptFact {
  id: number
  text: string
}

/** The EXISTING facts block + numbered questions, exactly as Triviadox's generator lays them out. */
export function buildFactsUserMessage(questions: PromptQuestion[], existing: PromptFact[], imageNotes: string[] = []): string {
  const existingBlock = existing.length
    ? existing.map((f) => `${f.id}. ${f.text}`).join('\n')
    : '(none yet for this subtopic)'
  const questionBlock = questions.map((q, i) => {
    const opts = q.options.map((o, k) => `${k === q.correctIndex ? '*' : '-'} ${o}`).join('\n')
    return `${i + 1}. ${q.question}\n${opts}\nCorrect: "${q.options[q.correctIndex] ?? ''}"`
  }).join('\n\n')
  return [
    'EXISTING key facts for this subtopic (id. text):',
    existingBlock,
    '',
    'QUESTIONS (* marks the correct option):',
    questionBlock,
    ...(imageNotes.length ? ['', 'ATTACHED IMAGES, in order:', ...imageNotes] : []),
  ].join('\n')
}

export type FactLink =
  | { q: number; matchId: number }
  | { q: number; newIndex: number }

/** First JSON value in a reply, tolerating code fences and stray text. */
function firstJson(raw: string): unknown {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/)
    if (!m) return undefined
    try { return JSON.parse(m[0]) } catch { return undefined }
  }
}

/**
 * `{"newFacts":[...],"results":[{"q":n,"matchId":id}|{"q":n,"newIndex":i}]}`.
 * Drops a matchId that is not one of `knownIds`, a newIndex outside newFacts,
 * a question number out of range and any second answer for the same question.
 */
export function parseFactsReply(raw: string, questionCount: number, knownIds: ReadonlySet<number>): { newFacts: string[]; links: FactLink[] } {
  const obj = firstJson(raw) as { newFacts?: unknown; results?: unknown } | undefined
  if (!obj || typeof obj !== 'object') return { newFacts: [], links: [] }
  const newFacts = Array.isArray(obj.newFacts) ? obj.newFacts.map((s) => String(s ?? '').replace(/\s+/g, ' ').trim()) : []
  const seen = new Set<number>()
  const links: FactLink[] = []
  for (const r of Array.isArray(obj.results) ? obj.results as Record<string, unknown>[] : []) {
    const q = Number(r?.q)
    if (!Number.isInteger(q) || q < 1 || q > questionCount || seen.has(q)) continue
    if (r.matchId != null && knownIds.has(Number(r.matchId))) {
      seen.add(q)
      links.push({ q, matchId: Number(r.matchId) })
    } else if (r.newIndex != null && Number.isInteger(Number(r.newIndex))) {
      const i = Number(r.newIndex)
      if (i >= 0 && i < newFacts.length && newFacts[i]) {
        seen.add(q)
        links.push({ q, newIndex: i })
      }
    }
  }
  return { newFacts, links }
}

// ── reconcile ────────────────────────────────────────────────────────────────

/**
 * Before sending: facts someone added on Triviadox while Codox worked. One
 * request per affected subtopic asks which of Codox's new facts already exist
 * there, so the questions are linked to the site's fact instead of a twin.
 */
export function buildReconcilePrompt(siteFacts: PromptFact[], candidates: string[]): string {
  return [
    'You compare medical key facts. Below are EXISTING key facts (id. text) and CANDIDATE facts (number. text).',
    'For each candidate that states the same testable point as an existing fact (even if worded differently), answer with that fact\'s id.',
    'Points that differ in a number, a direction, a negation or the condition named are NOT the same.',
    'Output STRICT JSON only: {"same":[{"candidate":<number>,"matchId":<id>}]} — leave out candidates with no match.',
    '',
    'EXISTING:',
    ...siteFacts.map((f) => `${f.id}. ${f.text}`),
    '',
    'CANDIDATES:',
    ...candidates.map((t, i) => `${i + 1}. ${t}`),
  ].join('\n')
}

export function parseReconcileReply(raw: string, candidateCount: number, siteIds: ReadonlySet<number>): Map<number, number> {
  const obj = firstJson(raw) as { same?: unknown } | undefined
  const out = new Map<number, number>()
  for (const r of Array.isArray(obj?.same) ? obj.same as Record<string, unknown>[] : []) {
    const c = Number(r?.candidate)
    const id = Number(r?.matchId)
    if (Number.isInteger(c) && c >= 1 && c <= candidateCount && siteIds.has(id) && !out.has(c - 1)) out.set(c - 1, id)
  }
  return out
}

// ── flashcards ───────────────────────────────────────────────────────────────

export function buildCardsUserMessage(facts: PromptFact[]): string {
  return 'Facts:\n' + facts.map((f) => `${f.id}: ${f.text}`).join('\n')
}

export interface Card {
  front: string
  back: string
  extra: string
}

export type CardOutcome =
  | { kind: 'card'; card: Card }
  | { kind: 'skip' }
  | { kind: 'dropped'; reason: string }

const BANNED: [RegExp, string][] = [
  [/\bbesides\b/i, '"besides…" list question'],
  [/which of the following/i, '"which of the following"'],
  [/^(is|are|does|do|can) /i, 'yes/no question'],
  [/^why /i, '"why" question'],
  // "Which nerve is NOT in the spermatic cord?" has countless right answers
  // (owner, 2026-11-17). The prompt already says to turn a negative fact into a
  // positive card; this catches the cards where the model did not. "Ineffective
  // for which drug?" (the owner's lithium card) is not caught: no "not"/"except".
  [/\b(not|except|never|least likely)\b/i, 'asks which one is not'],
]

/** The automatic card checks (the same ones the training cards passed). Empty = fine. */
export function cardProblems(c: Card): string[] {
  const out: string[] = []
  const front = c.front.toLowerCase()
  const back = c.back.toLowerCase().trim()
  if (!c.front.trim()) out.push('empty question')
  if (!back) out.push('empty answer')
  if (back && new RegExp(`\\b${back.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(front)) out.push('answer is in the question')
  if (c.back.trim().split(/\s+/).length > 5) out.push('answer over 5 words')
  if (c.extra.trim().split(/\s+/).filter(Boolean).length > 16) out.push('extra too long')
  for (const [re, label] of BANNED) if (re.test(c.front.trim())) out.push(label)
  return out
}

/** `{"cards":[...]}` or a bare list; one outcome per fact id asked about. */
export function parseCardsReply(raw: string, factIds: number[]): Map<number, CardOutcome> {
  const obj = firstJson(raw)
  const list = Array.isArray(obj) ? obj : Array.isArray((obj as { cards?: unknown })?.cards) ? (obj as { cards: unknown[] }).cards : []
  const byId = new Map<number, Record<string, unknown>>()
  for (const c of list as Record<string, unknown>[]) {
    const id = Number(c?.id)
    if (Number.isFinite(id) && !byId.has(id)) byId.set(id, c)
  }
  const out = new Map<number, CardOutcome>()
  for (const id of factIds) {
    const c = byId.get(id)
    if (!c) { out.set(id, { kind: 'dropped', reason: 'missing from the reply' }); continue }
    if (c.skip === true) { out.set(id, { kind: 'skip' }); continue }
    const card: Card = {
      front: String(c.q ?? '').trim(),
      back: String(c.a ?? '').trim(),
      extra: String(c.e ?? '').trim(),
    }
    const problems = cardProblems(card)
    out.set(id, problems.length ? { kind: 'dropped', reason: problems.join(', ') } : { kind: 'card', card })
  }
  return out
}
