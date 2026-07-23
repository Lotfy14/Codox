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
  finishedIncomplete: 'Done — but some questions couldn’t be included.',
  planningIssue: (count: number) =>
    'Codox couldn’t locate ' + count + ' question' + (count === 1 ? '' : 's') +
    ' on the page, so ' + (count === 1 ? 'it was' : 'they were') + ' left out. ' +
    'Only the questions it could read are in this bundle — check the original before importing.',
} as const

export const uploadMessages = {
  notPdf: (fileName: string) =>
    `Only PDF files work here — "${fileName}" was skipped.`,
  notPdfOrImage: (fileName: string) =>
    `Only PDF or image files work here — "${fileName}" was skipped.`,
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
  navCustomize: 'Customize',
  navFolders: 'Folders',
  navHistory: 'History',
  railApi: 'API',
  railHelp: 'Help',
  railDiagnostics: 'Diagnostics',
  railPrivacy: 'Privacy',
  storageLabel: 'On-device storage',
  quotaLabel: 'Gemini free requests today',
  apiDialogTitle: 'Gemini API key',
  helpDialogTitle: 'Help',
  privacyDialogTitle: 'Privacy',
  diagnosticsDialogTitle: 'Diagnostics',
  dialogDismiss: 'Close dialog',
  themeGroupLabel: 'Appearance',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
} as const

export const diagnosticsMessages = {
  problemsOnly: 'Problems only',
  downloadAll: 'Download all',
  downloadSelected: (count: number) => `Download selected (${count})`,
  clearSelected: (count: number) => `Clear selected (${count})`,
  clearAll: 'Clear all',
  detail: 'Details',
  empty: 'No events logged yet. Codox records key checks, conversions, and any problems here.',
  generalGroup: 'General',
  eventCount: (count: number) => `${count} event${count === 1 ? '' : 's'}`,
  selectGroup: (label: string) => `Select all logs from ${label}`,
  selectEvent: (event: string) => `Select ${event} log`,
} as const

export const updateMessages = {
  available: (version: string) => `Codox ${version} is available.`,
  download: 'Download update',
  update: 'Update',
  restart: 'Restart & update',
  installing: 'Updating…',
  downloading: 'Downloading…',
  // Android only: the installer was refused (usually "unknown sources" was
  // declined), so fall back to handing them the file.
  failed: 'Codox could not install the update itself.',
  dismiss: 'Dismiss update notice',
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
      body: 'Add a separate answer-key PDF if needed.',
    },
    {
      title: '4. Review and export',
      body: 'Convert, review flagged questions, then export.',
    },
  ],
  troubleTitle: 'If something gets in the way',
  trouble: 'Recheck a wrong key, wait if paused, or check your connection if unreachable.',
  /** Shown at the foot of Help so a user can report exactly which build they run. */
  version: (v: string) => `Codox v${v}`,
} as const

export const convertMessages = {
  title: 'Convert',
  subtitle:
    'Drop exam PDFs and Codox turns them into a Triviadox question set — all on this screen.',
  dropTitle: 'Drop PDFs here',
  dropHint: 'batch of PDFs supported',
  dropMoreTitle: 'Add PDFs',
  dropMoreHint: 'PDF files',
  keyDropTitle: 'Answer key',
  keyDropHint: 'this PDF only — PDF or image, paste or drop',
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
  answerKeyAddedFor: (fileName: string) => `Key: ${fileName}`,
  remove: 'Remove',
  keepOriginalLabel: 'Keep original PDFs',
  keepOriginalHint:
    'Keeps the exam PDFs and any answer key in History so they can be converted again later. Uses more space.',
  startButton: 'Start converting',
  startFailed:
    'Codox could not start this conversion on this device. Your PDFs are still here; try again.',
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
      planner_underextracted:
        'Gemini kept missing questions it had counted on the page, so Codox stopped rather than export an incomplete set.',
      worker_chunk_invalid:
        'Gemini could not return a valid question set for any question in this PDF, even after retries on smaller batches.',
      merge_validation_failed:
        'The extracted questions did not pass Codox’s safety checks.',
    }
    const detail = explanation[reason] ?? 'Codox could not finish this file.'
    return `${fileName} stopped. ${detail} Its pages and everything read so far are saved.`
  },
  retryStopped: 'Retry saved run',
  fixApiKey: 'Fix API key',
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
    'On a phone this opens the share sheet; on desktop it asks where to save the zip.',
} as const

export const customizeMessages = {
  title: 'Customize',
  subtitle:
    'Choose which optional details your exported question sets carry. These choices apply to conversions you start next — finished runs keep the columns they were made with.',
  yearPanelLabel: 'Year column',
  yearLegend: 'Year',
  yearOff: 'No year',
  yearOffHint: 'Exports have no year column.',
  yearType: 'You type it',
  yearTypeHint:
    'Convert shows a year field; the year you type applies to every question in the batch.',
  yearAi: 'From the document',
  yearAiHint:
    'Codox uses the year printed in the document when one is visible — blank otherwise. No extra AI requests.',
  topicsPanelLabel: 'Topics and subtopics',
  topicsLegend: 'Topics',
  topicsOff: 'Off',
  topicsOffHint: 'No topics on Convert, no topic columns in exports.',
  topicsOn: 'On',
  topicsOnHint:
    'Convert shows a topic list you can type or read from a topics PDF or image. After conversion, Gemini matches each question to your list — unsure stays blank.',
  exportPanelLabel: 'Export destination',
  exportLegend: 'Export',
  exportTriviadox: 'To Triviadox',
  exportTriviadoxHint:
    'The Export button sends the finished questions straight to Triviadox and opens the import page.',
  exportZip: 'ZIP file',
  exportZipHint:
    'The Export button saves a ZIP of the question CSV and images to this device instead.',
  debugPanelLabel: 'Debug console',
  debugLabel: 'Show debug console',
  debugHint:
    'Adds a timing panel to the Convert screen that shows each conversion step and how long it took — useful for finding what makes a run slow. Off by default; nothing is sent anywhere.',
  indexPanelLabel: 'Index requests',
  indexLabel: 'Pages per index request',
  indexHint:
    'How many pages each question-finding request covers. 10 is the default and the safest value. Lowering it splits the document into more overlapping pieces, and questions can be lost where those pieces meet — a run that came back short should try raising this, not lowering it. Lower it only when a page is being skipped entirely.',
  indexOption: (count: number) =>
    count === 10 ? '10 pages (default)' : count === 1 ? '1 page' : `${count} pages`,
  boxPanelLabel: 'Box requests',
  boxLabel: 'Pages per box request',
  boxHint:
    'How many pages each box-drawing request covers during conversion. 1 is the default and most accurate. Higher values spend fewer requests on big exams — useful against the daily free limit — but box accuracy can drop, so raise this only if you keep running out of quota.',
  boxOption: (count: number) =>
    count === 1 ? '1 page (default)' : `${count} pages`,
  workerPanelLabel: 'Worker requests',
  workerLabel: 'Questions per worker request',
  workerHint:
    'How many questions are transcribed in each request. Smaller batches keep every answer complete — the transcription model can drop options when a request grows long — while larger batches spend fewer requests. 6 is the default; lower it if some questions come back missing options.',
  workerOption: (count: number) =>
    count === 6 ? '6 questions (default)' : `${count} questions`,
  matchingPanelLabel: 'Matching questions',
  matchingLegend: 'Matching questions',
  matchingSplit: 'Split into single questions',
  matchingSplitHint:
    'Each item in a matching question becomes its own question, using the printed choices word for word. Codox never fills in which choice goes with which item — every split question arrives blank for you to answer in Review.',
  matchingSkip: 'Leave them out',
  matchingSkipHint:
    'Matching questions are dropped from the finished set. Everything else converts as usual.',
  modelNewer: 'Newer (default)',
  modelOlder: 'Steadier older',
  modelsPanelLabel: 'Which model does each step',
  modelsIntro:
    'Advanced. A conversion runs several steps that call Gemini, and you can pick the model for each one. Whichever model you do not pick for a step is used automatically as that step’s backup if the first is busy or unavailable — nothing is ever left unanswered. Both models run under your own key. Newer is Gemini 3.5 Flash-Lite; steadier older is Gemini 3.1 Flash-Lite, which is slower to hit the free per-minute limit and can be steadier on some documents. Leave these on the default unless you have a reason to change them.',
  modelIndexLabel: 'Finding questions',
  modelIndexHint:
    'Reads the pages to list every question and where it sits. This also runs the fallback re-read of any page that comes back empty.',
  modelEvidenceLabel: 'Reading a separate answer key',
  modelEvidenceHint:
    'Reads a separate answer-key document (when you add one) to locate each answer. Skipped when there is no separate key.',
  modelFigureLabel: 'Spotting figures',
  modelFigureHint:
    'Detects images and diagrams attached to a question so they get cropped with it.',
  modelBoxLabel: 'Drawing crops',
  modelBoxHint:
    'Draws the exact box around each question, its options, and any figure. This is the geometry-heavy step where the two models differ most — if crops come out misaligned, try the steadier older model here.',
  modelWorkerLabel: 'Transcribing questions',
  modelWorkerHint:
    'Types out each question and its choices word for word.',
  modelAuditLabel: 'Double-checking',
  modelAuditHint:
    'The final read-through that checks the transcribed questions against the pages before the set is finished.',
} as const

export const debugMessages = {
  panelLabel: 'Debug console',
  panelTitle: 'Debug console — step timing',
  waiting: 'Waiting for the first step to finish…',
  total: 'Total (measured)',
  now: (step: string) => `Now: ${step}`,
} as const

export const topicsMessages = {
  editorLabel: 'Your topic list',
  editorHint:
    'Type your topics — or drop a topics PDF or image and Codox fills this list for you to check.',
  topicPlaceholder: 'Topic',
  subtopicPlaceholder: 'Subtopic',
  addTopic: 'Add topic',
  addSubtopic: 'Add subtopic',
  removeTopic: (topic: string) =>
    `Remove topic${topic === '' ? '' : ` ${topic}`}`,
  removeSubtopic: (subtopic: string) =>
    `Remove subtopic${subtopic === '' ? '' : ` ${subtopic}`}`,
  demoteTopic: 'Make a subtopic of…',
  demoteTopicLabel: (topic: string) =>
    `Make ${topic === '' ? 'this topic' : topic} a subtopic of another topic`,
  promoteSubtopic: 'Make topic',
  promoteSubtopicLabel: (subtopic: string) =>
    `Make ${subtopic === '' ? 'this subtopic' : subtopic} its own topic`,
  topicLabel: (position: number) => `Topic ${position}`,
  subtopicLabel: (topicPosition: number, position: number) =>
    `Topic ${topicPosition} subtopic ${position}`,
  dropTitle: 'Topics file (optional)',
  dropHint: 'PDF or image — paste or drop',
  docAdded: (fileName: string) => `${fileName} added`,
  reading: 'Reading your topics…',
  readSuccess: (fileName: string) =>
    `Topics read from ${fileName} — check and edit the list below.`,
  readAgain: 'Read again',
  readUnreadable:
    'Codox could not find a topic list in this file. You can still type your topics below.',
  readWrongKey:
    'Gemini rejected the saved API key, so the topics file was not read. Fix the key, then choose Read again.',
  readFailed:
    'Gemini could not read this file right now. Choose Read again to retry, or type the topics below.',
  readQuotaPaused:
    'Your Gemini allowance is resting — Codox keeps trying and reads the topics file when it can. You can type the topics below meanwhile.',
  readUnreachable:
    "Can't reach Gemini right now — Codox retries automatically. You can also type the topics below meanwhile.",
  yearLabel: 'Year (optional)',
  yearHint: 'Applies to every question in this batch.',
  matching: 'Matching questions to your topics…',
  matchIncomplete: (count: number) =>
    `${count} question${count === 1 ? '' : 's'} not matched to a topic yet — exports leave those topic cells blank.`,
  matchWrongKey:
    'Topic matching stopped: Gemini rejected the saved API key. Fix the key, then retry.',
  retryMatching: 'Retry topic matching',
  rematchOpen: 'Edit topics & re-match',
  rematchClose: 'Close topic editor',
  rematchHint:
    'Rename or remove topics, then re-match. This re-labels every question against the edited list — it does not re-run the conversion.',
  rematchSave: 'Save & re-match',
  rematchSaving: 'Re-matching…',
  rematchProgress: (done: number, total: number) =>
    `Re-matching… ${done} of ${total}`,
  rematchDone: 'Topics saved and questions re-matched.',
  rematchEmpty:
    'Topics cleared — this run will export without topic columns.',
  rematchFailed:
    'Topic matching could not finish right now. Try Save & re-match again in a moment.',
  rematchQuotaPaused:
    'Your Gemini allowance is resting — try Save & re-match again shortly. Any matches already made are kept.',
  rematchUnreachable:
    "Can't reach Gemini right now — try Save & re-match again in a moment. Any matches already made are kept.",
  // Shown when a finished run had no topic list at all — the tutor can add
  // one now and match without re-running the conversion.
  addOpen: 'Add topic matching',
  addHint:
    'Drop a topics document (PDF or image) to read the list, or type it by hand — then match. This labels every question against your list without re-running the conversion.',
} as const

export const reviewMessages = {
  questionCount: (count: number) =>
    `${count} question${count === 1 ? '' : 's'}`,
  searchLabel: 'Find a question',
  searchPlaceholder: 'Question number or words',
  searchNoMatches: 'No questions match this search.',
  jumpHiddenByFilter:
    'That question is hidden by the needs-review filter. Show all questions to open it.',
  needsReviewFilter: (count: number) => `Needs review (${count})`,
  showAllFilter: 'Show all questions',
  fileSwitcherLabel: 'Choose a converted file',
  answerBlank: '—',
  backToList: 'Back to questions',
  questionPosition: (current: number, total: number) =>
    `Question ${current} of ${total}`,
  listPanelLabel: 'Converted questions',
  confirm: 'Confirm answer (Enter)',
  previous: 'Previous (←)',
  next: 'Next (→)',
  wholePage: 'Show whole page (W)',
  questionArea: 'Back to the question area (W)',
  pickAnswer: 'Pick the correct answer',
  notMcqNotice:
    'This item has no answer options, so it is not a multiple-choice question. Codox exports MCQs only — edit it into a question with at least two options, or delete it.',
  sourceUnavailable: 'No source image is stored for this question.',
  sourceUnavailableLabel: 'Source unavailable',
  sourceAlt: (questionNumber: number) =>
    `Scanned source for question ${questionNumber}`,
  figureAlt: (questionNumber: number, figureNumber: number) =>
    `Figure ${figureNumber} linked to question ${questionNumber}`,
  figureCaption: (figureNumber: number, total: number) =>
    total === 1 ? 'Linked figure' : `Linked figure ${figureNumber} of ${total}`,
  pageCaption: (page: number, fileName: string, wholePage: boolean) =>
    `Page ${page} · ${fileName}${wholePage ? ' · whole page' : ''}`,
  reviewHeading: (fileName: string) => `Review · ${fileName}`,
  pagePosition: (questionNumber: number, pageIndex: number | null) =>
    `Question ${questionNumber}${pageIndex === null ? '' : `, page ${pageIndex + 1}`}`,
  backToResults: 'Back to results',
  flagsResolved: (resolved: number, total: number) =>
    `Flags resolved ${resolved} of ${total}`,
  offlineIsFine:
    'You are offline. Reviewing works fully offline — export whenever you finish.',
  allResolved: 'All flags resolved. Your answers are in — export the bundle.',
  edit: 'Edit (E)',
  editedBadge: 'Edited',
  editHeading: (questionNumber: number) => `Edit question ${questionNumber}`,
  editQuestionLabel: 'Question text',
  editOptionsLegend: 'Answer options — mark the correct one',
  editOptionLabel: (letter: string) => `Option ${letter} text`,
  editOptionCorrect: (letter: string) => `Option ${letter} is correct`,
  editRemoveOption: (letter: string) => `Remove option ${letter}`,
  editAddOption: 'Add option',
  editNoCorrect:
    'No answer is marked correct — this question stays flagged for review.',
  editAnswerCleared:
    'The correct option was removed, so the answer is now blank.',
  editValidationEmptyQuestion: 'The question text cannot be empty.',
  editValidationEmptyOption: 'Options cannot be empty — write text or remove them.',
  editValidationTooFewOptions: 'A question needs at least two options.',
  editTopicLabel: 'Topic',
  editSubtopicLabel: 'Subtopic',
  editYearLabel: 'Year',
  editMetaHint:
    'Topic, subtopic and year go into the exported CSV when set — leave blank to omit.',
  editPicturesLegend: 'Linked pictures',
  editNoPictures: 'No pictures are linked to this question.',
  editRemovePicture: (position: number) => `Unlink picture ${position}`,
  editAddPicture: 'Link a picture from this file',
  editNoPicturesAvailable:
    'This file has no other extracted pictures to link.',
  editPictureAlt: (path: string) => `Extracted picture ${path}`,
  editPastePictureHint:
    'Paste an image (Ctrl/⌘+V) to attach it as a linked picture.',
  editSave: 'Save changes',
  editCancel: 'Cancel',
  editRevert: 'Remove all edits on this question',
  bulkSelectRow: (questionNumber: number) => `Select question ${questionNumber}`,
  bulkSelectAll: (count: number) => `Select all ${count}`,
  bulkClearSelection: 'Clear selection',
  bulkSelectedCount: (count: number) =>
    `${count} question${count === 1 ? '' : 's'} selected`,
  bulkBarLabel: 'Set topic, subtopic and year on the selected questions',
  bulkTopicLabel: 'Topic',
  bulkSubtopicLabel: 'Subtopic',
  bulkYearLabel: 'Year',
  bulkApply: 'Apply to selected',
  bulkClearFields: 'Clear topic, subtopic & year on selected',
  bulkApplyHint:
    'Leave a box empty to keep each question’s current value; fill it to set the same value on every selected question.',
  bulkApplied: (count: number) =>
    `Updated ${count} question${count === 1 ? '' : 's'}.`,
  bulkCleared: (count: number) =>
    `Cleared topic, subtopic and year on ${count} question${count === 1 ? '' : 's'}.`,
  bulkNothingToApply: 'Fill in a topic, subtopic or year first.',
  addRow: 'Add question',
  addRowHint: 'Adds a blank question at the end for you to fill in.',
  deleteSelected: (count: number) =>
    `Delete ${count} question${count === 1 ? '' : 's'}`,
  rowsDeleted: (count: number) =>
    `Deleted ${count} question${count === 1 ? '' : 's'}. They will not be exported.`,
  undoDelete: 'Undo',
} as const

export const exportMessages = {
  notExportedYet: 'Not exported yet',
  exported: 'Exported',
  cancelled: 'Export cancelled. Your finished work is still saved in Codox.',
  downloadedToFolder:
    'The zip went to your browser’s Downloads folder — look for it there.',
  nothingToExport: 'There is no finished bundle to export yet.',
  failed:
    'Codox could not create the bundle. Your finished work is still saved.',
  exportDone:
    'Saved. The bundle now lives safely outside Codox — import it into Triviadox whenever you like.',
  whyExportMatters:
    'Codox stores work in the browser, which the system can clear to free space. An exported bundle is the copy nothing can take away.',
  triviadoxDone: 'Exported successfully! Opening Triviadox…',
  exportToPrefix: 'Export to',
  triviadoxName: 'Triviadox',
  downloadZip: 'Download ZIP',
  holdbackTitle: 'Some questions still need review',
  holdbackBody: (count: number) =>
    `${count} question${count === 1 ? '' : 's'} still ${count === 1 ? 'needs' : 'need'} review and won’t be exported — only questions with a confirmed answer are included. Keep reviewing to include them.`,
  holdbackConfirm: 'Export the rest',
  holdbackCancel: 'Keep reviewing',
} as const

/** Shared copy for asking Gemini to answer questions (the Review screen). */
export const aiSolveMessages = {
  quotaNote: (requests: number) =>
    requests === 0
      ? 'Using saved AI answers — no new Gemini requests.'
      : `About ${requests} Gemini request${requests === 1 ? '' : 's'} against your key.`,
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
  cancel: 'Cancel',
} as const

export const aiReviewMessages = {
  openDialog: 'AI answers…',
  dialogTitle: 'AI answers',
  dialogDescription:
    'Gemini answers from its own knowledge, not from your document. AI answers are kept separate — nothing changes until you approve it.',
  noneYet: 'The AI has not looked at this file yet.',
  coverage: (answered: number, total: number) =>
    `The AI has looked at ${answered} of ${total} questions.`,
  askAll: (count: number) =>
    `Ask AI about all ${count} questions`,
  askRemaining: (count: number) =>
    count === 1
      ? 'Ask AI about the remaining question'
      : `Ask AI about the ${count} remaining questions`,
  askAgainAll: 'Ask everything again',
  applyLegend: 'Switch to AI answers',
  summaryFill: (count: number) =>
    `${count} unanswered question${count === 1 ? ' gets' : 's get'} the AI's answer.`,
  summaryDiffer: (count: number) =>
    count === 1
      ? '1 existing answer is replaced by the AI’s different pick.'
      : `${count} existing answers are replaced by the AI’s different picks.`,
  summaryAgree: (count: number) =>
    `The AI agrees with ${count} existing answer${count === 1 ? '' : 's'} — ${count === 1 ? 'it stays' : 'they stay'} as ${count === 1 ? 'it is' : 'they are'}.`,
  summaryUnsure: (count: number) =>
    `${count} stay${count === 1 ? 's' : ''} untouched — the AI was not sure enough.`,
  applyButton: (count: number) =>
    `Switch ${count} answer${count === 1 ? '' : 's'} to AI`,
  nothingToApply:
    'Nothing to switch — the AI has no confident answer that differs from what you already have.',
  appliedNote: (count: number) =>
    `${count} answer${count === 1 ? '' : 's'} switched to AI. You can still change any of them on its question.`,
  close: 'Close',
  // Detail-view suggestion strip
  stripLabel: 'AI answer',
  askOne: 'Ask AI (A)',
  asking: 'Asking Gemini…',
  askAgainOne: 'Ask again',
  suggestion: (letter: string) => `AI answer: ${letter}`,
  confidence: {
    certain: 'confident',
    likely: 'likely',
    unsure: 'unsure',
  } as Record<string, string>,
  useAi: 'Use AI answer (A)',
  aiAgrees: 'The AI agrees with this answer.',
  aiUnsure: 'The AI was not sure about this one.',
  // List chips
  chipSuggests: (letter: string) => `AI: ${letter}`,
  chipDiffers: (letter: string) => `AI picked ${letter}`,
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
  reviewAction: 'Review answers',
  backToHistory: 'Back to history',
  exportComplete: 'Bundle saved outside Codox.',
  exportDownloaded:
    'Bundle saved to your browser’s Downloads folder.',
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

export const folderMessages = {
  title: 'Folders',
  intro:
    'Group several exam PDFs into one folder — convert them as you go, match every question against one shared topic list, and export all of them together in a single bundle.',
  emptyTitle: 'No folders yet',
  emptyBody: 'Create a folder to collect exams that belong together.',
  newFolder: 'New folder',
  newFolderTitle: 'Name your folder',
  nameLabel: 'Folder name',
  namePlaceholder: 'e.g. Cardiology block',
  create: 'Create folder',
  cancel: 'Cancel',
  open: 'Open',
  back: 'Back to folders',
  rename: 'Rename',
  renameSave: 'Save name',
  delete: 'Delete folder',
  deleteTitle: (name: string) => `Delete "${name}"?`,
  deleteBody:
    'This removes the folder and every PDF, conversion, and result inside it. This cannot be undone.',
  confirmDelete: 'Delete folder',
  pdfCount: (count: number) => `${count} PDF${count === 1 ? '' : 's'}`,
  doneCount: (done: number, total: number) => `${done} of ${total} converted`,
  dropTitle: 'Add exam PDFs',
  dropHint: 'Drop PDFs here, or choose files. Add as many as you like.',
  dropMoreTitle: 'Add more PDFs',
  filesHeading: 'PDFs in this folder',
  statusNotConverted: 'Not converted',
  statusConverting: 'Converting…',
  statusNeedsReview: (count: number) => `${count} to review`,
  statusReady: 'Ready',
  statusStopped: 'Stopped',
  convert: 'Convert',
  convertAll: 'Convert all pending',
  review: 'Review',
  remove: 'Remove',
  excludeFromTopics: 'Skip topic matching',
  topicsHeading: 'Shared topics',
  topicsHint:
    'One topic list for the whole folder. Match it across every PDF at once — skip any PDF with its toggle.',
  matchAll: 'Match topics across all PDFs',
  matching: 'Matching questions to your topics…',
  matchProgress: (done: number, total: number) => `Matched ${done} of ${total} PDFs…`,
  matchDone: (count: number) => `Matched ${count} PDF${count === 1 ? '' : 's'} against your topics.`,
  matchNoTopics: 'Add some topics first, then match.',
  matchNoRuns: 'Convert at least one PDF before matching topics.',
  matchWrongKey: 'That Gemini key was rejected. Fix it in the API panel, then match again.',
  matchFailed: 'Topic matching could not finish. Try again.',
  exportAll: 'Export all',
  exportNothing: 'Convert and resolve some questions first — there is nothing to export yet.',
  exportComplete: 'Exported the folder.',
  exportDownloaded: 'Saved the folder bundle to your Downloads.',
  exportCancelled: 'Export cancelled.',
  exportFailed: 'Export failed. Try again.',
  convertFailed: 'Could not start the conversion.',
  needsKey: 'Add a working Gemini API key first.',
} as const

/**
 * Importing a folder an agent produced (agent-conversion/). Deliberately says
 * "read from the document" vs "worked out" rather than naming any model — what
 * matters to a tutor is whether a human still has to approve the answer.
 */
export const agentImportMessages = {
  importFolder: 'Import agent folder',
  importIntoFolder: 'Import agent folder',
  hint: 'Bring in questions a coding agent extracted with agent-conversion. Pick the output folder it wrote.',
  unsupported:
    'Choosing a folder needs a desktop browser or the Windows app — this device cannot open a folder picker.',
  working: 'Reading the folder…',
  progress: (done: number, total: number, name: string) =>
    `Importing ${name} — ${done} of ${total}…`,
  summaryTitle: 'Imported',
  nothingFound:
    'No exam.json was found in that folder. Pick the folder agent-prepare wrote, or the batch folder above it.',
  failedTitle: (name: string) => `${name} could not be imported`,
  examLine: (name: string, questions: number) =>
    `${name} — ${questions} question${questions === 1 ? '' : 's'}`,
  answersRead: (count: number) => `${count} answered from the document`,
  answersPending: (count: number) =>
    `${count} suggested answer${count === 1 ? '' : 's'} waiting for you to approve`,
  answersFlagged: (count: number) =>
    `${count} still need${count === 1 ? 's' : ''} review`,
  warningsTitle: 'Worth a look',
  reportTitle: "The agent's notes",
  done: 'Open review',
  failed: 'That folder could not be imported.',
} as const
