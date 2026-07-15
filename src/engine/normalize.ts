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
 * Strips that leading label from a question prompt. Shape-based on purpose:
 * with per-page reading-order indexing the recorded printed number is not a
 * trustworthy anchor (it may itself be misread), so this does NOT require the
 * prefix to equal any recorded label — it removes whatever enumeration marker
 * the worker transcribed. If stripping would empty the prompt, the original
 * is kept so the empty-question guard sees the real (non-empty) text.
 */
export function stripLeadingQuestionLabel(question: string): string {
  const stripped = question.replace(LEADING_QUESTION_LABEL, '')
  return stripped.trim() === '' ? question : stripped
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
