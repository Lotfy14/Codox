/**
 * Every tutor-visible message in Codox — the canonical, owner-reviewed
 * strings. This file is the single source of truth for copy; the running
 * app is where the owner reviews it.
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
  aiStudioUrl: 'https://aistudio.google.com/api-keys',
  aiStudioAccountAction: 'Sign in or create an account',
  aiStudioBeforeLink: ' at ',
  aiStudioLink: 'Google AI Studio',
  aiStudioBeforeKey: ' to generate your ',
  aiStudioKey: 'free Gemini API key',
  aiStudioBeforePaste: ', then ',
  aiStudioPasteAction: 'paste it here',
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
  setupRequired:
    'Gemini accepted the key but cannot run Codox’s required model. Enable billing or model access for this API project, then check the key again.',
  /** The quota-isolation guarantee, stated directly. */
  keyOwnership:
    'Codox uses the Gemini API key you provide. Check key sends one tiny generation request; conversions count toward that key’s quota.',
  showKey: 'Show key',
  hideKey: 'Hide key',
  copyKey: 'Copy key',
  keyCopied: 'Key copied.',
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
  finishedWithFlags: (flagCount: number) =>
    `Done. ${flagCount} answer${flagCount === 1 ? '' : 's'} need${flagCount === 1 ? 's' : ''} your eyes — everything else is ready.`,
  finishedClean: 'Done. Every answer was read cleanly.',
} as const

export const uploadMessages = {
  notPdf: (fileName: string) =>
    `Only PDF files work here — "${fileName}" was skipped.`,
  encryptedPdf: (fileName: string) =>
    `"${fileName}" is password-protected, so Codox cannot open it. Remove the password and drop it again.`,
  keyFileOptional:
    'Optional — have a separate answer-key PDF? Drop it here and Codox reads it alongside the exams. Codox finds answers printed on the pages by itself.',
  chooseFiles: 'Choose files',
  pageCount: (pages: number) => `${pages} page${pages === 1 ? '' : 's'}`,
  flagLabel: 'Needs attention',
  removeFile: (fileName: string) => `Remove ${fileName}`,
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
  themeGroupLabel: 'Appearance',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
} as const

export const privacyMessages = {
  local: 'Your API key, PDFs, and results are stored on this device.',
  processing:
    'When you convert, Codox sends the exam pages and any separate answer-key pages to Google Gemini for processing.',
  quota: 'Gemini requests use your key and count toward your quota.',
} as const

export const coachmarkMessages = {
  eyebrow: 'First step',
  title: 'Add your Gemini API key',
  bodyBeforeKey: 'Codox ',
  bodyKey: 'needs your key',
  bodyBeforeAction: ' before it can ',
  bodyAction: 'convert a PDF',
  action: 'Open API settings',
  dismiss: 'Dismiss API key tip',
} as const

export const helpMessages = {
  intro: 'From PDF to Triviadox bundle in four steps.',
  openApi: 'Open API key settings',
  steps: [
    {
      title: '1. Connect Gemini',
      body: 'Open API, paste your Gemini key, and choose Check key.',
    },
    {
      title: '2. Add the PDFs',
      body: 'Drop one or more exam PDFs onto Convert.',
    },
    {
      title: '3. Add an answer key (optional)',
      body: 'Drop a separate answer-key PDF if you have one. Codox reads answers printed inside the PDFs on its own.',
    },
    {
      title: '4. Review and export',
      body: 'Start converting, check anything Codox flags, then export the Triviadox bundle.',
    },
  ],
  troubleTitle: 'If something gets in the way',
  trouble:
    'Wrong key means Gemini rejected it. Paused means its allowance needs time. Unreachable means Codox cannot contact Gemini. Your saved progress stays on this device.',
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
  batchPanelLabel: 'Batch files',
  optionsPanelLabel: 'Before you start',
  progressPanelLabel: 'Conversion progress',
  finishedPanelLabel: 'Conversion finished',
  readingPdf: 'Reading PDF…',
  filesReady: (count: number) => `${count} PDF${count === 1 ? '' : 's'} ready`,
  clearAll: 'Clear all',
  inplaceBefore:
    'Progress, flagged questions to review, and export all appear ',
  inplaceHighlight: 'right here',
  inplaceAfter: ' — no new tabs, no takeover screen.',
  answerKeyAdded: (fileName: string) => `${fileName} added`,
  remove: 'Remove',
  keepOriginalLabel: 'Keep original PDFs',
  keepOriginalHint:
    'Keeps the exam PDFs and any answer key in History so they can be converted again later. Uses more space.',
  startButton: 'Start converting',
  startFailed:
    'Codox could not start this conversion on this device. Your PDFs are still here; try again.',
  apiKeyRequired: 'Add and check your Gemini API key before converting.',
  stopButton: 'Stop converting',
  convertingFiles: (count: number) =>
    `Converting ${count} PDF${count === 1 ? '' : 's'}`,
  allPages: 'All pages',
  stoppedHeading: 'This run stopped.',
  stoppedRun: (fileName: string, reason: string) => {
    const explanation: Record<string, string> = {
      'billing-required':
        'Gemini requires billing to be enabled for this API project.',
      'invalid-request':
        'Gemini rejected the document request. Try a smaller PDF or fewer pages.',
      'model-unavailable':
        'The required Gemini model is not available for this API key.',
      'temporarily-unavailable':
        'Gemini stayed unavailable after several automatic retries.',
      'provider-error': 'Gemini could not complete the request.',
      'wrong-key': 'Gemini rejected the saved API key.',
      'unexpected_error': 'Codox hit an unexpected device error.',
      'source_pdf_missing': 'The original PDF is no longer on this device.',
      cancelled: 'You stopped the conversion.',
      render_failed: 'Codox could not read any page from this PDF.',
      planner_unparseable: 'Gemini did not return a readable question plan.',
      planner_invalid_after_repair:
        'Gemini could not produce a valid question plan after a repair attempt.',
      worker_chunk_invalid:
        'Gemini could not return a valid question set after a repair attempt.',
      merge_validation_failed:
        'The extracted questions did not pass Codox’s safety checks.',
    }
    const detail = explanation[reason] ?? 'Codox could not finish this file.'
    return `${fileName} stopped. ${detail} Its pages and everything read so far are saved.`
  },
  retryStopped: 'Retry saved run',
  fixApiKey: 'Fix API key',
  unsafeRuns: (count: number) =>
    `${count === 1 ? 'One file came' : `${count} files came`} back with checks that did not pass, so ${count === 1 ? 'it is' : 'they are'} marked for your review before import. Codox never guesses.`,
  reviewFlags: (count: number, fileName?: string) =>
    `Review ${count} flag${count === 1 ? '' : 's'}${fileName ? ` · ${fileName}` : ''}`,
  exportAgain: 'Export again',
  exportAsIs: 'Export as-is',
  exportBundle: 'Export bundle',
  convertAnother: 'Convert another',
  convertAnotherHint:
    'Convert another moves these statuses to History and opens a clean converter. Original PDFs are removed unless you chose Keep original PDFs.',
  startingFresh: 'Starting fresh…',
  exportDeviceNote:
    'On a phone this opens the share sheet; on desktop it downloads a zip.',
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
  cancelled: 'Export cancelled. Your finished work is still saved in Codox.',
  nothingToExport: 'There is no finished bundle to export yet.',
  failed:
    'Codox could not create the bundle. Your finished work is still saved.',
  exportDone:
    'Saved. The bundle now lives safely outside Codox — import it into Triviadox whenever you like.',
  whyExportMatters:
    'Codox stores work in the browser, which the system can clear to free space. An exported bundle is the copy nothing can take away.',
  menuLabel: 'More export options',
  withoutAnswers: 'Export without answers',
  withoutAnswersHint: 'A practice set — every answer column left blank.',
  withAiAnswers: 'Export with AI answers…',
  withAiAnswersHint: 'Gemini answers questions from its own knowledge.',
} as const

export const aiExportMessages = {
  title: 'Export with AI answers',
  description:
    'Gemini answers from its own knowledge, not from your document. Every AI-filled row is marked ai_answered in the CSV, so you can always tell these answers apart.',
  scopeLegend: 'Which questions should the AI answer?',
  scopeUnanswered: 'Only unanswered questions',
  scopeUnansweredHint:
    'Answers found in the document or confirmed by you stay untouched.',
  scopeVerify: 'Unanswered + double-check the rest',
  scopeVerifyHint:
    'Also compares document answers with its own; disagreements are flagged, never changed.',
  scopeAll: 'Every question',
  scopeAllHint:
    'AI answers replace document answers too. Uses the most quota.',
  thresholdLegend: 'When unsure, the AI should…',
  thresholdCertain: 'Only answer when certain',
  thresholdCertainHint: 'Anything less stays blank and flagged for you.',
  thresholdLikely: 'Answer when certain or likely',
  thresholdLikelyHint: 'Blank only when the AI says it would be guessing.',
  thresholdNever: 'Answer whenever it can',
  thresholdNeverHint: 'Accepts every answer the AI gives, however unsure.',
  quotaNote: (requests: number) =>
    requests === 0
      ? 'Using saved AI answers — no new Gemini requests.'
      : `About ${requests} Gemini request${requests === 1 ? '' : 's'} against your key.`,
  savedAnswersNote: (when: string) =>
    `Saved AI answers from ${when} cover these questions.`,
  reSolve: 'Ask Gemini again',
  solving: (done: number, total: number) =>
    `Asking Gemini… ${done}/${total}`,
  solvePausedQuota:
    'Paused — Gemini’s allowance needs a moment. Answers so far are saved; this continues automatically.',
  solveUnreachable:
    'Cannot reach Gemini right now. Answers so far are saved — try again when the connection returns.',
  solveWrongKey:
    'Gemini rejected the saved API key. Fix the key, then try again.',
  solveFailed:
    'Gemini could not answer right now. Answers so far are saved — try again in a moment.',
  confirm: 'Answer and export',
  cancel: 'Cancel',
} as const

export const historyMessages = {
  emptyTitle: 'No runs yet',
  emptyBody:
    'Saved conversions and stopped runs will appear here. Start on Convert when you are ready.',
  retentionNote:
    'Runs stay on this device until you delete them or the system clears site data. Original PDFs are retained only when Keep original PDFs was selected.',
  reRunNeedsOriginal:
    'Re-running needs the original PDF, which was not kept for this run. Drop the PDF on Convert to run it again.',
  currentNotEmpty:
    'Convert already has a PDF or run in progress. Finish or clear that workspace before restoring this PDF.',
  restoreFailed:
    'Codox could not restore this PDF. The historical run was not changed.',
  deleteFailed:
    'Codox could not delete this run. It is still saved on this device.',
  useAgainAction: 'Use PDF again',
  exportAction: 'Export bundle',
  exportAgainAction: 'Export again',
  exportComplete: 'Bundle saved outside Codox.',
  exportCancelled: 'Export cancelled. This run is still saved in History.',
  exportUnavailable: 'This run does not have a finished bundle to export.',
  exportFailed: 'Codox could not create this bundle. The saved run was not changed.',
  deleteTitle: (runName: string) => `Delete ${runName}?`,
  deleteBody:
    'This removes the run and its stored files from this device. Bundles you already exported are not affected.',
  current: 'Current workspace',
  originalKept: 'Original PDF kept',
  originalRemoved: 'Original PDF removed',
  exported: 'Exported',
  notExported: 'Not exported',
  pages: (count: number) => `${count} page${count === 1 ? '' : 's'}`,
  requests: (count: number) =>
    `${count} Gemini request${count === 1 ? '' : 's'}`,
  deleteAction: 'Delete from history',
  cancelDelete: 'Keep run',
  confirmDelete: 'Delete run',
  status: {
    running: 'Converting',
    paused: 'Paused',
    stopped: 'Stopped',
    done: 'Ready',
  },
} as const
