/**
 * Every tutor-visible message in Codox — the canonical, owner-reviewed
 * strings from design-system/ERROR_LANGUAGE.md. That document is the source
 * of truth: update this file from it, never the other way around.
 *
 * The rules these strings follow:
 * - Bad key ≠ can't reach ≠ quota used up. Three situations, three
 *   messages, three colors. Never just "failed".
 * - Quota is calm: "paused / resting", amber, never red, never "error".
 * - Order inside a message: what happened → is my work safe → what to do.
 * - Codox never guesses, and the words say so wherever it matters.
 * - Gemini is the only provider; no failover or add-provider language.
 */

export const keyMessages = {
  /** Shown under an empty key field when the user tries to check it. */
  emptyKey: 'Paste a key first.',
  checking: 'Checking your key…',
  /** Live-validation success. */
  working: 'Key works. You are ready to convert.',
  wrongKey:
    "Gemini rejected this key. Check that you copied the whole key, or make a new one on Google's API key page.",
  unreachable:
    "Can't reach Gemini right now. This is not about your key — Gemini may be down or blocked on this network. Your progress is saved; Codox will try again when the connection returns.",
  quotaPaused:
    'Your Gemini key has used its available free allowance. Nothing is broken — your progress is saved, and the run resumes when Gemini allows requests again.',
  /** The quota-isolation guarantee, stated directly. */
  keyOwnership:
    "Codox uses only your Gemini key. Requests count against your Gemini quota and never another user's.",
} as const

export const progressMessages = {
  pausedQuota:
    'Paused — resumes when quota allows. Your progress is saved; there is nothing you need to do.',
  offline:
    'No internet connection. The run picks up exactly where it left off when you are back online.',
  geminiUnreachable:
    'Gemini is unavailable right now. Your progress is saved, and the run resumes when Gemini is reachable again.',
  geminiQuotaPause:
    'Your Gemini allowance is resting. The run resumes when Gemini allows requests again — you can close Codox and come back later.',
  badPage: (page: number, fileName: string) =>
    `Page ${page} of ${fileName} could not be read reliably. It is flagged for your review — the rest of the run continues.`,
  wrongDeclaration: (fileName: string) =>
    `The answers in ${fileName} do not match what you declared. To be safe, every question from this file is flagged for your review — Codox never guesses.`,
  finishedWithFlags: (flagCount: number) =>
    `Done. ${flagCount} answer${flagCount === 1 ? '' : 's'} need${flagCount === 1 ? 's' : ''} your eyes — everything else is ready.`,
  finishedClean: 'Done. Every answer was read cleanly.',
} as const

export const uploadMessages = {
  notPdf: (fileName: string) =>
    `Only PDF files work here — "${fileName}" was skipped.`,
  encryptedPdf: (fileName: string) =>
    `"${fileName}" is password-protected, so Codox cannot open it. Remove the password and drop it again.`,
  declarationQuestion: 'Where are the answers?',
  declarationHelp:
    'This tells Codox how to read each PDF. If a file is different, change it on that row.',
  needsKeyFile:
    'You said the answers are in a separate file — drop that answer key below before starting.',
  chooseFiles: 'Choose files',
  answerSourceLabel: 'Answers',
  flagLabel: 'Needs attention',
  removeFile: (fileName: string) => `Remove ${fileName}`,
  batchDefault: 'Use batch default',
  insideThisPdf: 'Inside this PDF',
  separateKeyFile: 'Separate key file',
  noAnswersProvided: 'No answers provided',
  insidePdfs: 'Inside the PDFs',
  inSeparateKeyFile: 'In a separate answer key file',
  noAnswers: 'There are no answers',
} as const

export const appMessages = {
  brandName: 'Codox',
  navLabel: 'Workspace',
  navConvert: 'Convert',
  navHistory: 'History',
  railApi: 'API',
  railHelp: 'Help',
  railPrivacy: 'Privacy',
  storageLabel: 'On-device storage',
  apiDialogTitle: 'Gemini API key',
  helpDialogTitle: 'Help',
  privacyDialogTitle: 'Privacy',
  dialogDismiss: 'Close dialog',
  loadingPdfCheck: 'Loading PDF check…',
  themeGroupLabel: 'Appearance',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
} as const

export const convertMessages = {
  title: 'Convert',
  subtitle:
    'Drop exam PDFs and Codox turns them into a Triviadox question set — all on this screen.',
  dropTitle: 'Drop PDFs here',
  dropHint: 'batch of PDFs supported',
  dropMoreTitle: 'Drop more PDFs here',
  dropMoreHint: 'Add more PDFs to this batch',
  keyDropTitle: 'Drop the answer key here',
  keyDropHint: 'PDF answer key',
  startPanelLabel: 'Start a conversion',
  batchPanelLabel: 'Batch files',
  optionsPanelLabel: 'Before you start',
  progressPanelLabel: 'Conversion progress',
  finishedPanelLabel: 'Conversion finished',
  readingPdf: 'Reading PDF…',
  filesReady: (count: number) => `${count} PDF${count === 1 ? '' : 's'} ready`,
  batchOverrideHint:
    'Change any file below if its answers differ from the batch default.',
  clearAll: 'Clear all',
  answerKeyAdded: (fileName: string) => `${fileName} added`,
  remove: 'Remove',
  keepOriginalLabel: 'Keep original PDF',
  keepOriginalHint:
    'Keeps the PDF stored in Codox so this run can be converted again later. Uses more space.',
  pagesMinutes: (pages: number, minutes: number) =>
    `${pages} page${pages === 1 ? '' : 's'} · about ${minutes} min`,
  startButton: 'Start converting',
  convertingFiles: (count: number) =>
    `Converting ${count} PDF${count === 1 ? '' : 's'}`,
  allPages: 'All pages',
  stoppedHeading: 'This run stopped.',
  stoppedRun: (fileName: string, reason: string) =>
    `${fileName} stopped: ${reason}. Its pages and everything read so far are saved.`,
  unsafeRuns: (count: number) =>
    `${count === 1 ? 'One file came' : `${count} files came`} back with checks that did not pass, so ${count === 1 ? 'it is' : 'they are'} marked for your review before import. Codox never guesses.`,
  reviewFlags: (count: number, fileName?: string) =>
    `Review ${count} flag${count === 1 ? '' : 's'}${fileName ? ` · ${fileName}` : ''}`,
  exportAgain: 'Export again',
  exportAsIs: 'Export as-is',
  exportBundle: 'Export bundle',
  convertAnother: 'Convert another',
  exportDeviceNote:
    'On a phone this opens the share sheet; on desktop it downloads a zip.',
  devGrade: 'Dev: grade this run in CodoxSandbox',
  devDownloadCsv: (fileName: string) => `Download ${fileName} CSV`,
  devRunStats: (requests: number, tokens: number, auditUnavailable: boolean) =>
    `${requests} requests · ${tokens} tokens${auditUnavailable ? ' · audit unavailable' : ''}`,
} as const

export const reviewMessages = {
  whyFlagged: {
    'blank-answer':
      'No answer found — Codox never guesses, so this one is yours.',
    'conflicting-marks':
      'Two answers appear marked. Pick the right one from the page.',
    'length-mismatch':
      'The options list looks incomplete. Check it against the page.',
    'low-confidence':
      'The scan is hard to read here. Confirm what the page says.',
  },
  flagsRemainOnExport: (flagCount: number) =>
    `${flagCount} answer${flagCount === 1 ? '' : 's'} still need${flagCount === 1 ? 's' : ''} your eyes. You can export as-is — unresolved rows stay blank and marked for review. They are never guessed.`,
  offlineIsFine:
    'You are offline. Reviewing works fully offline — export whenever you finish.',
  allResolved: 'All flags resolved. Your answers are in — export the bundle.',
} as const

export const exportMessages = {
  notExportedYet: 'Not exported yet',
  exported: 'Exported',
  exportDone:
    'Saved. The bundle now lives safely outside Codox — import it into Triviadox whenever you like.',
  whyExportMatters:
    'Codox stores work in the browser, which the system can clear to free space. An exported bundle is the copy nothing can take away.',
} as const

export const historyMessages = {
  emptyTitle: 'No runs yet',
  emptyBody:
    'Completed conversions will appear here. Start on Convert when you are ready.',
  reRunNeedsOriginal:
    'Re-running needs the original PDF, which was not kept for this run. Drop the PDF on Convert to run it again.',
  deleteTitle: (runName: string) => `Delete ${runName}?`,
  deleteBody:
    'This removes the run and its stored files from this device. Bundles you already exported are not affected.',
} as const

export const firstRunMessages = {
  welcome:
    'Codox turns exam PDFs into ready-to-import Triviadox question sets. It runs on this device — you bring your own Gemini API key.',
  geminiKeyNote:
    "Codox uses only this Gemini key. Every request counts against your own Gemini quota, never another user's.",
  /** The owner-approved one-line minimal privacy notice. */
  privacyNotice:
    'Exam pages go straight from this device to Gemini, under your key. Your key never leaves this device.',
} as const
