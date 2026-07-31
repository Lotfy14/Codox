/**
 * Deterministic reconciliation of compact index windows. Printed labels are
 * evidence only; the source location is the stable identity used for retries,
 * figures, and deduplication.
 */
import type { IndexedQuestion, IndexWindow, PageManifest } from './index-pass'
import type { PlanningIssue } from '../state/types'

export interface ReconciledQuestion extends IndexedQuestion {
  ref: string
  ownerPage: number
  sourcePages: number[]
  sectionKey: string
}
/** One removed observation, for diagnostics. Reconciliation is silent
 *  otherwise, and a rule that deletes real questions is invisible without it. */
export interface DroppedQuestion {
  ref: string
  printedLabel: string
  ownerPage: number
  rule: 'duplicate_label' | 'duplicate_anchor' | 'page_not_owned' | 'covered_reread'
  twinRef?: string
}
/**
 * One question whose two observing windows disagreed about which page it is on.
 *
 * INDEX numbers its response against the images it was handed, and on a window
 * with a leading context page it sometimes numbers from the first CORE page
 * instead — shifting every page reference in that response by one. The ±1
 * tolerance in `twin` was absorbing this silently: the two observations were
 * correctly recognised as the same question, one was dropped, and whichever was
 * seen first won the page. Measured 2026-07-31 over four stored runs: 22 of 30
 * twinned questions disagreed by exactly 1, and rendering the pages confirmed
 * the winner is arbitrary (EMLE questions 70-72 kept p24, correct; Family
 * Medicine questions 19-21 kept p22, actually printed on p21).
 *
 * A wrong owner page is handed to BOX as the image to draw on, so the anchor is
 * not on it and the region fails — the three `no box region after retry` flags
 * on EMLE page 14 are exactly the three questions printed on page 13.
 *
 * Recorded here, resolved by `verifyOwnerPages` where a text layer can prove
 * the page, and flagged by the executor only when it cannot.
 */
export interface PageDisagreement {
  ref: string
  printedLabel: string
  /** The page the kept observation claims. */
  keptPage: number
  /** The page the dropped twin claimed instead. */
  otherPage: number
}
export interface ReconciledIndex {
  questions: ReconciledQuestion[]
  pages: PageManifest[]
  issues: PlanningIssue[]
  drops: DroppedQuestion[]
  disagreements: PageDisagreement[]
}
/** A localized window keeps the observations it does not own: a page whose
 *  owning window saw nothing is otherwise lost even though a neighbour read
 *  it correctly across the context overlap. */
export interface LocalizedIndexWindow extends IndexWindow {
  disowned: IndexedQuestion[]
}

function normalHint(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
function sectionKey(question: IndexedQuestion): string {
  const hint = normalHint(question.sectionHint)
  return hint === '' ? 'page-' + question.ownerPage : hint
}

/** Convert one window's relative page coordinates into absolute coordinates. */
export function localizeIndexWindow(
  window: IndexWindow,
  contextPages: readonly number[],
  corePages: readonly number[],
  windowId: number,
): LocalizedIndexWindow {
  const questions: IndexedQuestion[] = []
  const disowned: IndexedQuestion[] = []
  window.questions.forEach((question, ordinal) => {
    const ownerPage = contextPages[question.ownerPage - 1]
    const sourcePages = question.sourcePages
      .map((page) => contextPages[page - 1])
      .filter((page): page is number => page !== undefined)
    if (ownerPage === undefined || sourcePages.length === 0) return
    const localized = {
      ...question,
      ref: 'w' + windowId + 'q' + ordinal,
      ownerPage,
      sourcePages: [...new Set(sourcePages)].sort((a, b) => a - b),
    }
    // The ownership rule still decides the primary result. A disowned
    // observation is held back rather than discarded: it is the only record
    // of that page if the owning window emitted nothing for it.
    if (corePages.includes(ownerPage)) questions.push(localized)
    else disowned.push(localized)
  })
  const pages = window.pages.flatMap((manifest) => {
    const p = contextPages[manifest.page - 1]
    return p === undefined ? [] : [{ ...manifest, page: p }]
  })
  return { questions, pages, disowned }
}

/**
 * Union shifted/retried windows without trusting model-issued references.
 * Same owner page + normalized anchor is intentionally conservative: a near
 * duplicate is retained rather than silently deleting a real question.
 *
 * Ordering is per-page reading order: within a page the questions keep the
 * order INDEX emitted them (top to bottom), NOT the order of their printed
 * numbers. A vision model lists a page's questions top-to-bottom far more
 * reliably than it OCRs a faint two-digit label, so a misread "19"→"1" can
 * no longer leapfrog a question to the top. The printed number is kept only
 * as the row's display label. Completeness — a genuinely skipped question —
 * is the read-only audit's job, not something inferred from the numbering.
 */
function isGenericAnchor(anchor: string): boolean {
  const generic = [
    'which',
    'what',
    'select',
    'choose',
    'according',
    'refer',
    'please',
    'in the',
    'the most',
    'how',
    'why',
    'where',
    'case stem',
    'question',
  ]
  const norm = normalHint(anchor)
  return norm.length < 12 || generic.some((g) => norm.startsWith(g))
}

export function reconcileIndexWindows(
  windows: readonly (IndexWindow & { disowned?: IndexedQuestion[] })[],
): ReconciledIndex {
  const kept: { question: ReconciledQuestion; windowIndex: number }[] = []
  const drops: DroppedQuestion[] = []
  const disagreements: PageDisagreement[] = []
  const pagesByNumber = new Map<number, PageManifest>()
  /** The two windows recognised the same question but not the same page. */
  const noteDisagreement = (
    question: IndexedQuestion & { ownerPage: number },
    duplicate: { ref: string; ownerPage: number },
  ) => {
    if (duplicate.ownerPage === question.ownerPage) return
    disagreements.push({
      ref: duplicate.ref,
      printedLabel: question.printedLabel,
      keptPage: duplicate.ownerPage,
      otherPage: question.ownerPage,
    })
  }

  /**
   * The duplicate a window boundary creates, and nothing else.
   *
   * Cores partition the document and never overlap (windows.ts), so the only
   * way one question can be observed twice is by two DIFFERENT windows — the
   * owning one and a neighbour reading it across the context overlap. Two
   * questions emitted by the SAME window are separate items in a single
   * top-to-bottom reading pass and are never duplicates of each other.
   *
   * Scoping both rules to cross-window pairs is what makes the anchor rule
   * safe. Exam stems are formulaic ("A 25-year-old man presents with …"), so
   * prefix-matching within a page silently deleted genuinely distinct
   * questions — 8 of them on a real 100-question paper — while
   * isGenericAnchor waved them through as "specific". The mismatched-label
   * tolerance stays: a straddling question really can have its printed number
   * misread by one of the two windows that can see it.
   */
  const twin = (
    question: IndexedQuestion & { ownerPage: number },
    windowIndex: number,
  ): { ref: string; ownerPage: number; rule: DroppedQuestion['rule'] } | undefined => {
    const labelKey = question.printedLabel.trim()
    const normAnchor = normalHint(question.anchor)
    for (const entry of kept) {
      if (entry.windowIndex === windowIndex) continue
      const other = entry.question
      if (Math.abs(other.ownerPage - question.ownerPage) > 1) continue
      if (labelKey !== '' && other.printedLabel.trim() === labelKey) {
        return { ref: other.ref, ownerPage: other.ownerPage, rule: 'duplicate_label' }
      }
      if (normAnchor === '') continue
      const otherNorm = normalHint(other.anchor)
      const isPrefixMatch =
        otherNorm.startsWith(normAnchor) || normAnchor.startsWith(otherNorm)
      if (isPrefixMatch && !isGenericAnchor(other.anchor) && !isGenericAnchor(question.anchor)) {
        return { ref: other.ref, ownerPage: other.ownerPage, rule: 'duplicate_anchor' }
      }
    }
    return undefined
  }

  windows.forEach((window, windowIndex) => {
    for (const page of window.pages) pagesByNumber.set(page.page, page)
    for (const question of window.questions) {
      const duplicate = twin(question, windowIndex)
      if (duplicate !== undefined) {
        noteDisagreement(question, duplicate)
        drops.push({
          ref: question.ref,
          printedLabel: question.printedLabel,
          ownerPage: question.ownerPage,
          rule: duplicate.rule,
          twinRef: duplicate.ref,
        })
        continue
      }
      kept.push({ question: { ...question, sectionKey: sectionKey(question) }, windowIndex })
    }
  })

  // Rescue pass. A disowned observation is normally the neighbour's redundant
  // second look at a page its owner already covered — dropped. But when the
  // owning window emitted NOTHING for that page, the neighbour's reading is
  // the only record there is, and discarding it loses real questions to a gap
  // between two windows that each had a valid reason to pass. Observed on a
  // real paper: three questions on a core's last page, read correctly by the
  // next window and thrown away by both.
  // The test is per-question, not per-page. A page is not all-or-nothing: the
  // owning window can emit some of a page's questions and miss the rest, which
  // is exactly what happened on the paper this rescues — the owner read 55-57
  // off its core's last page and stopped, and the next window's reading of
  // 58-60 was the only record of them. So a disowned observation is kept
  // unless something already kept is recognisably the same question.
  //
  // COVERED RE-READ. `twin` recognises "the same question" by its printed
  // label or a prefix-shared anchor. Both can break across a window seam at
  // once: the owner may number a page from a different origin (its last two
  // questions owned as "2","3" while the neighbour re-read them as "42","43")
  // AND word the anchor differently ("acute lower limb ischemia" vs "what is
  // the initial treatment …", which share no tokens). `twin` then sees two
  // distinct questions and the rescue keeps the neighbour's copy — a verbatim
  // duplicate row.
  //
  // The signal that the neighbour is RE-READING the owner's page (not
  // continuing past its tail) is alignment: the owner and the neighbour both
  // enumerate a page top-to-bottom, so if ANY of the neighbour's disowned
  // observations on a page twin-confirms against an owned question, the
  // neighbour is reading that same page — and provided it re-read no MORE than
  // the owner emitted (no genuinely-new tail to protect), every one of its
  // disowned observations on that page is a re-read, including the ones a
  // relabel and a reworded anchor hid from `twin`. Both conditions are load
  // bearing: without the twin-confirmed alignment this would swallow the
  // questions an owner truncated and a neighbour uniquely saw (the 58-60
  // rescue, whose disowned reads twin-confirm nothing on that page); without
  // the count ceiling it would drop a genuinely-new tail the neighbour read
  // past the owner's stopping point.
  const ownedByPage = new Map<number, number>()
  for (const entry of kept) {
    ownedByPage.set(entry.question.ownerPage, (ownedByPage.get(entry.question.ownerPage) ?? 0) + 1)
  }
  const coveredPages = new Set(kept.map((entry) => entry.question.ownerPage))
  windows.forEach((window, windowIndex) => {
    const disowned = window.disowned ?? []
    // Per page: how many this window re-read, and whether any re-read
    // twin-confirms it is reading the owner's page rather than a disjoint tail.
    const rereadCount = new Map<number, number>()
    const alignedPages = new Set<number>()
    for (const question of disowned) {
      rereadCount.set(question.ownerPage, (rereadCount.get(question.ownerPage) ?? 0) + 1)
      if (twin(question, windowIndex) !== undefined) alignedPages.add(question.ownerPage)
    }
    for (const question of disowned) {
      const page = question.ownerPage
      const ownerCount = ownedByPage.get(page) ?? 0
      const coveredReread =
        alignedPages.has(page) && (rereadCount.get(page) ?? 0) <= ownerCount
      // An unnumbered question with a generic anchor has no identity strong
      // enough for `twin` to recognise, so it falls back to the conservative
      // page test rather than risk duplicating a row.
      const weakIdentity =
        question.printedLabel.trim() === '' && isGenericAnchor(question.anchor)
      const duplicate = twin(question, windowIndex)
      if (
        !coveredReread &&
        duplicate === undefined &&
        !(weakIdentity && coveredPages.has(page))
      ) {
        kept.push({ question: { ...question, sectionKey: sectionKey(question) }, windowIndex })
        continue
      }
      if (duplicate !== undefined) noteDisagreement(question, duplicate)
      drops.push({
        ref: question.ref,
        printedLabel: question.printedLabel,
        ownerPage: page,
        rule: duplicate?.rule ?? (coveredReread ? 'covered_reread' : 'page_not_owned'),
        ...(duplicate === undefined ? {} : { twinRef: duplicate.ref }),
      })
    }
  })

  const questions = kept.map((entry) => entry.question)
  // Page, then emission order. Each page is owned by exactly one window's
  // core (localizeIndexWindow), so a page's questions all share a window id
  // and the ref ordinal is that window's top-to-bottom reading order. The
  // printed number never reorders and never infers a gap — real exams number
  // non-sequentially, so a genuine 18→20 jump must not invent a phantom 19.
  questions.sort((a, b) => a.ownerPage - b.ownerPage || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
  const issues: PlanningIssue[] = []
  for (const manifest of pagesByNumber.values()) {
    if (!manifest.containsQuestionStart) continue
    if (!questions.some((question) => question.ownerPage === manifest.page)) {
      issues.push({ kind: 'unreadable_page', page: manifest.page, section: manifest.sectionHint })
    }
  }
  return {
    questions,
    pages: [...pagesByNumber.values()].sort((a, b) => a.page - b.page),
    issues,
    drops,
    disagreements,
  }
}

/**
 * Prove each question's owner page against the page's own text layer, and
 * correct it when the two disagree by one.
 *
 * The anchor INDEX returns is verbatim visible text, and every page's text
 * layer is already extracted at render (`page-text` artifacts) — so for a
 * born-digital PDF the true page is a string search, with no model call, no
 * prompt change, and no new data. Verified 2026-07-31 on the EMLE run: the
 * anchors for questions 37-39 appear on page 13 and nowhere else, while the
 * planner had assigned them to page 14.
 *
 * Deliberately narrow, so this can only ever repair the observed defect:
 *
 * - Only pages `ownerPage ± 1` are candidates. The failure is a one-page window
 *   shift; a match further away is far more likely a repeated formulaic stem,
 *   and relocating a question across a document on a text match would be a new
 *   and worse guess.
 * - The anchor must hit EXACTLY ONE candidate page. A short or formulaic anchor
 *   ("which of the following…") matches all three and is left alone rather than
 *   resolved arbitrarily.
 * - A scan has no text layer, so nothing matches and every page is left exactly
 *   as the planner had it. This is a no-op on those documents, never a downgrade.
 *
 * `sourcePages` shifts with the owner page: the defect is a uniform shift of one
 * response, so a question whose stem straddles a break keeps its span.
 */
export interface PageVerification {
  questions: ReconciledQuestion[]
  /** Questions whose page the text layer moved. */
  corrected: { ref: string; from: number; to: number }[]
  /** Questions whose page the text layer positively confirmed. */
  confirmedRefs: Set<string>
}

/** Below this an anchor is too short to identify a page. */
const MIN_ANCHOR_CHARS = 12

export function verifyOwnerPages(
  questions: readonly ReconciledQuestion[],
  pageText: ReadonlyMap<number, string>,
): PageVerification {
  if (pageText.size === 0) {
    return { questions: [...questions], corrected: [], confirmedRefs: new Set() }
  }
  const normalized = new Map<number, string>()
  for (const [page, text] of pageText) normalized.set(page, normalHint(text))

  const corrected: { ref: string; from: number; to: number }[] = []
  const confirmedRefs = new Set<string>()
  const verified = questions.map((question) => {
    const anchor = normalHint(question.anchor)
    if (anchor.length < MIN_ANCHOR_CHARS) return question
    const hits = [question.ownerPage - 1, question.ownerPage, question.ownerPage + 1].filter(
      (page) => (normalized.get(page) ?? '').includes(anchor),
    )
    if (hits.length !== 1) return question
    const [page] = hits
    if (page === question.ownerPage) {
      confirmedRefs.add(question.ref)
      return question
    }
    const delta = page - question.ownerPage
    corrected.push({ ref: question.ref, from: question.ownerPage, to: page })
    confirmedRefs.add(question.ref)
    const shifted = question.sourcePages
      .map((source) => source + delta)
      .filter((source) => source > 0)
    return {
      ...question,
      ownerPage: page,
      sourcePages: [...new Set(shifted.length === 0 ? [page] : shifted)].sort((a, b) => a - b),
    }
  })
  // A corrected page changes reading order, so restore the same page-then-
  // emission-order sort reconciliation guarantees its callers.
  verified.sort(
    (a, b) =>
      a.ownerPage - b.ownerPage ||
      a.ref.localeCompare(b.ref, undefined, { numeric: true }),
  )
  return { questions: verified, corrected, confirmedRefs }
}
