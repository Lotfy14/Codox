/**
 * Post-merge option-label stripping (pure). The worker transcribes labels
 * verbatim (§2.2) precisely so this code — not the weakest model — decides
 * what is a label. NEVER-GUESS shapes the rules:
 *
 * - Strip only when EVERY option in the row carries the SAME label style
 *   and the labels run sequentially from the style's conventional start
 *   ("A"/"a", "1", "i"). Anything less stays verbatim — a label left in
 *   the text is cosmetic; a stripped non-label is destroyed content.
 * - The letter-dot style ("A. …") collides with genus abbreviations
 *   ("A. baumannii", "B. cepacia", "C. difficile" are real options AND a
 *   sequential A/B/C set). When every stripped remainder looks like a
 *   bare species epithet (one all-lowercase word), that is genuine
 *   ambiguity: leave the text verbatim and report it so the row can be
 *   flagged for human review instead of guessed at.
 */

export interface NormalizedOptions {
  options: string[]
  /** True when a plausible label set was left in place out of caution. */
  ambiguous: boolean
}

/**
 * A leading printed question label: an optional "Q"/"Question", 1–3 digits,
 * an enumeration separator, then whitespace. The separator-plus-whitespace is
 * the safety: it distinguishes a label ("18– A 49yo…", "5. What is…") from a
 * prompt that genuinely opens with a number ("18 patients were enrolled…",
 * "3-day history of fatigue…", where no separator follows). 1–3 digits keeps
 * a leading 4-digit year ("2022. In this trial…") from reading as a label.
 */
const LEADING_QUESTION_LABEL = /^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):\-–—]\s+/i

/**
 * Strips that leading label from a question prompt or case stem. Shape-based on
 * purpose: with per-page reading-order indexing the recorded printed number is
 * not a trustworthy anchor (it may itself be misread), so this does NOT require
 * the prefix to equal any recorded label — it removes whatever enumeration
 * marker the worker transcribed. Applied per-part at merge (the stem and the
 * prompt are separate verbatim fields, §2.2). If stripping would empty the
 * text, the original is kept so the empty-question guard sees the real text.
 */
export function stripLeadingQuestionLabel(question: string): string {
  const stripped = question.replace(LEADING_QUESTION_LABEL, '')
  return stripped.trim() === '' ? question : stripped
}

/**
 * A GFM table separator row — pipes, dashes, optional colons and whitespace,
 * nothing else ("|---|---|" or "| :--- | ---: |"). This is the one
 * unambiguous marker that a run of pipe-bearing lines is a real table and not
 * prose that merely contains a "|". Requiring it (plus a pipe-bearing header
 * line directly above) is what keeps the stripper from eating a sentence.
 */
function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.includes('|') &&
    trimmed.includes('-') &&
    /^[|:\-\s]+$/.test(trimmed)
  )
}

/** A table row is any non-blank line carrying a column pipe. */
function isTableRow(line: string): boolean {
  return line.trim() !== '' && line.includes('|')
}

/**
 * Removes a GFM table block from an assembled question, keeping the prose
 * around it. Only ever called for rows that already carry an `image_urls`
 * asset (the caller's guard): the table has been captured as a figure crop
 * that ships to Triviadox, so the linearized pipe-text in the stem is
 * redundant noise on the card. When the row has NO image the caller keeps the
 * text, because it is then the only copy of the table — NEVER-GUESS applies to
 * deletion too, a lost table is worse than an ugly one.
 *
 * A block is a pipe-bearing header line, a separator row directly below it,
 * and every contiguous pipe-bearing line after that. If stripping would empty
 * the question (a stem that was nothing but a table), the original is kept so
 * the empty-question guard sees real text rather than a blank card.
 */
export function stripTableBlock(question: string): string {
  const lines = question.split('\n')
  for (let i = 1; i < lines.length; i += 1) {
    if (!isTableSeparatorRow(lines[i]) || !lines[i - 1].includes('|')) continue
    const start = i - 1
    let end = i
    while (end + 1 < lines.length && isTableRow(lines[end + 1])) end += 1
    const kept = [...lines.slice(0, start), ...lines.slice(end + 1)]
    const result = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    return result === '' ? question : result
  }
  return question
}

interface LabelMatch {
  /** The label token, e.g. "A", "3", "iv". */
  label: string
  /** Option text after the label and its separator/whitespace. */
  rest: string
}

interface LabelStyle {
  name: string
  match(option: string): LabelMatch | null
  /** True when labels run sequentially from the conventional start. */
  sequential(labels: string[]): boolean
}

function regexStyle(name: string, pattern: RegExp, sequential: LabelStyle['sequential']): LabelStyle {
  return {
    name,
    match(option) {
      const m = pattern.exec(option)
      return m === null ? null : { label: m[1], rest: option.slice(m[0].length) }
    },
    sequential,
  }
}

function sequentialLetters(labels: string[]): boolean {
  const first = labels[0]
  if (first !== 'A' && first !== 'a') return false
  const start = first.charCodeAt(0)
  return labels.every((label, i) => label.charCodeAt(0) === start + i)
}

function sequentialNumbers(labels: string[]): boolean {
  return labels.every((label, i) => Number.parseInt(label, 10) === i + 1)
}

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 }

function romanToInt(label: string): number | null {
  const lower = label.toLowerCase()
  if (lower !== label && label.toUpperCase() !== label) return null
  let total = 0
  for (let i = 0; i < lower.length; i += 1) {
    const value = ROMAN_VALUES[lower[i]]
    if (value === undefined) return null
    const next = ROMAN_VALUES[lower[i + 1]]
    total += next !== undefined && next > value ? -value : value
  }
  return total
}

function sequentialRoman(labels: string[]): boolean {
  return labels.every((label, i) => romanToInt(label) === i + 1)
}

/**
 * Style order matters only for the roman/letter overlap ("i." is both):
 * roman is tried first, so "i., ii., iii." strips as roman while a lone
 * "i." in a letter run fails both and stays verbatim.
 */
const LABEL_STYLES: LabelStyle[] = [
  regexStyle('roman-dot', /^([ivxlIVXL]{1,6})\.\s+/, sequentialRoman),
  regexStyle('roman-paren', /^\(?([ivxlIVXL]{1,6})\)\s*/, sequentialRoman),
  regexStyle('letter-dot', /^([A-Za-z])\.\s+/, sequentialLetters),
  regexStyle('letter-paren', /^\(?([A-Za-z])\)\s*/, sequentialLetters),
  regexStyle('number-dot', /^(\d{1,2})\.\s+/, sequentialNumbers),
  regexStyle('number-paren', /^\(?(\d{1,2})\)\s*/, sequentialNumbers),
]

/** One all-lowercase word — the species-epithet shape ("baumannii"). */
const EPITHET_SHAPE = /^[a-z]+$/

/**
 * Strips enumeration labels from one row's options per the module rules.
 * Returns the (possibly unchanged) options plus whether an ambiguous
 * label set was deliberately left in place.
 */
export function stripEnumerationLabels(
  options: readonly string[],
): NormalizedOptions {
  if (options.length < 2) return { options: [...options], ambiguous: false }

  for (const style of LABEL_STYLES) {
    const matches = options.map((option) => style.match(option))
    if (matches.some((m) => m === null)) continue
    const found = matches as LabelMatch[]
    if (!style.sequential(found.map((m) => m.label))) continue
    if (found.some((m) => m.rest.length === 0)) continue

    if (
      style.name === 'letter-dot' &&
      found.every((m) => EPITHET_SHAPE.test(m.rest))
    ) {
      return { options: [...options], ambiguous: true }
    }
    return { options: found.map((m) => m.rest), ambiguous: false }
  }

  return { options: [...options], ambiguous: false }
}
