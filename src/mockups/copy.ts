/**
 * Every tutor-visible message in Codox, written in plain English.
 *
 * This is the Phase 3 error-language pass. The rules these strings follow:
 * - Bad key ≠ provider unreachable ≠ quota exhausted. Never collapse them.
 * - Quota reads as "paused", calm, never as an error.
 * - A message says what happened, whether work is safe, and what (if
 *   anything) the user should do — in that order, without jargon.
 * - Codox never guesses: anything uncertain is flagged, and the words say so.
 *
 * The owner-review copy of this list lives in
 * design-system/ERROR_LANGUAGE.md. Keep the two in sync.
 */

export const keyCopy = {
  /** Shown under an empty key field when the user tries to check it. */
  emptyKey: 'Paste a key first.',
  checking: 'Checking your key…',
  /** Live-validation success. */
  working: 'Key works. You are ready to convert.',
  wrongKey: (provider: string) =>
    `${provider} rejected this key. Check that you copied the whole key, or make a new one on ${provider}'s website.`,
  unreachable: (provider: string) =>
    `Can't reach ${provider} right now. This is not about your key — the service may be down or blocked on this network. During a run, Codox simply tries your next provider.`,
  quotaPaused: (provider: string) =>
    `This ${provider} key has used up its free daily allowance. Nothing is broken — it rests until ${provider} resets the limit, then works again on its own.`,
  usedFirst: 'Used first',
  failoverExplainer:
    'Codox tries your providers in this order. If one is resting or unreachable mid-run, the next takes over — the run keeps going.',
} as const

export const progressCopy = {
  pausedQuota:
    'Paused — resumes when quota allows. Your progress is saved; there is nothing you need to do.',
  offline:
    'No internet connection. The run picks up exactly where it left off when you are back online.',
  providerSwitch: (from: string, to: string) =>
    `${from} is unavailable — continuing with ${to}. The run keeps going.`,
  allProvidersResting:
    'All your providers are resting until their free quota returns. The run resumes on its own — you can close Codox and come back later.',
  badPage: (page: number, fileName: string) =>
    `Page ${page} of ${fileName} could not be read reliably. It is flagged for your review — the rest of the run continues.`,
  wrongDeclaration: (fileName: string) =>
    `The answers in ${fileName} do not match what you declared. To be safe, every question from this file is flagged for your review — Codox never guesses.`,
  finishedWithFlags: (flagCount: number) =>
    `Done. ${flagCount} answer${flagCount === 1 ? '' : 's'} need${flagCount === 1 ? 's' : ''} your eyes — everything else is ready.`,
  finishedClean: 'Done. Every answer was read cleanly.',
} as const

export const uploadCopy = {
  notPdf: (fileName: string) =>
    `Only PDF files work here — "${fileName}" was skipped.`,
  encryptedPdf: (fileName: string) =>
    `"${fileName}" is password-protected, so Codox cannot open it. Remove the password and drop it again.`,
  declarationQuestion: 'Where are the answers?',
  declarationHelp:
    'This tells Codox how to read each PDF. If a file is different, change it on that row.',
  needsKeyFile:
    'You said the answers are in a separate file — drop that answer key below before starting.',
  keepOriginalHelp:
    'Keeps the PDF stored in Codox so this run can be converted again later. Uses more space.',
} as const

export const reviewCopy = {
  whyFlagged: {
    'blank-answer': 'No answer found — Codox never guesses, so this one is yours.',
    'conflicting-marks': 'Two answers appear marked. Pick the right one from the page.',
    'length-mismatch': 'The options list looks incomplete. Check it against the page.',
    'low-confidence': 'The scan is hard to read here. Confirm what the page says.',
  },
  flagsRemainOnExport: (flagCount: number) =>
    `${flagCount} answer${flagCount === 1 ? '' : 's'} still need${flagCount === 1 ? 's' : ''} your eyes. You can export as-is — unresolved rows stay blank and marked for review. They are never guessed.`,
  offlineIsFine:
    'You are offline. Reviewing works fully offline — export whenever you finish.',
  allResolved: 'All flags resolved. Your answers are in — export the bundle.',
} as const

export const exportCopy = {
  notExportedYet: 'Not exported yet',
  exported: 'Exported',
  exportDone:
    'Saved. The bundle now lives safely outside Codox — import it into Triviadox whenever you like.',
  whyExportMatters:
    'Codox stores work in the browser, which the system can clear to free space. An exported bundle is the copy nothing can take away.',
} as const

export const firstRunCopy = {
  privacyNotice:
    'Exam pages go straight from this device to the AI provider, under your key. Your key never leaves this device.',
  welcome:
    'Codox turns exam PDFs into ready-to-import Triviadox question sets. It runs entirely on this device — you bring one free AI key.',
  keyStepHelp:
    'One key is enough to start. You can add more providers later in the Keys tab for a bigger daily allowance.',
} as const

export const historyCopy = {
  reRunNeedsOriginal:
    'Re-running needs the original PDF, which was not kept for this run. Drop the PDF on Convert to run it again.',
  deleteTitle: (runName: string) => `Delete ${runName}?`,
  deleteBody:
    'This removes the run and its stored files from this device. Bundles you already exported are not affected.',
} as const
