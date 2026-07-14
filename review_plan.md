# Review redesign: full row list + detail (Convert & History)

## Context

Today Review shows only flagged questions, one at a time, only for the current
job. The owner wants Review to become the browsing surface for a finished
conversion: every CSV row visible in a scrollable virtualized list on the
Convert screen (below the finished-summary panel), with a total count,
number-jump + text search, a needs-review filter, and a detail view where any
row (flagged or not) can be inspected and its answer set by an explicit human
pick. History runs get the same experience. The old one-flag-at-a-time
ReviewStage is replaced. NEVER-GUESS stays intact: all writes go through the
existing `review-resolutions` mechanism.

Owner-approved decisions:
1. Batch → one list per file with a file switcher; numbers 1..N per file.
2. Any row opens full detail and is editable (human override stored as resolution).
3. Search: all-digits query jumps+highlights that question; other text filters rows by question/option text.
4. Old guided flag flow replaced — needs-review filter + detail reproduces it.
5. History review ships in this task; archived runs keep ALL artifacts (page JPEGs included — already true today, `archiveCurrentJobAndReset` never touches `db.runArtifacts`).
6. Layout: list below the done-summary panel; detail swaps the work area; Back restores list scroll + filter.

**Step 0 (owner request):** write this plan as `review_plan.md` at the repo root and commit it.

Deferred follow-up (separate task, owner-approved earlier, do NOT do here):
stop-discards-current-job + clean-slate-on-fresh-open.

## Package decision (search-before-build done)

**`@tanstack/react-virtual`** — MIT, ~7.4 KB gzip, very active (3.14.6,
2026-07-12), first-class `scrollToIndex`. Chosen over react-aria's bundled
Virtualizer because the latter's imperative jump API couldn't be verified.
Isolated in ONE file (`review-virtual.ts`) so it's swappable. Fixed row height
(single-line ellipsis rows) → exact windowing, no measurement pass.

## Implementation steps

### 1. Generalize data layer — `src/screens/review-data.ts`
- `ReviewFlag` → `ReviewRow` (same shape; `category: FlagCategory | null`, null when not flagged). `ReviewData` = `{ rows, reviewRows }` with a `ReviewRow` for EVERY row (questionNumber = index+1). Helper `flaggedRows(data)` keeps flag semantics one call away.
- `loadReviewData`: `flatMap`-over-flagged → `map`-over-all. Build a `Map<rowId, PlannedRow>` once for `sourceRegion` (kills the O(n²) find; box math unchanged).
- New pure `effectiveAnswer(row, resolutions): number | null` — validated resolution overrides engine `correct_index` (mirrors `applyResolutions` guard).
- Untouched: `saveResolution`, `applyResolutions`, `useResolutions`, `unresolvedCount`, `useUnresolvedCounts`, artifact kinds/schema.

### 2. New pure module — `src/screens/review-filter.ts`
- `type ReviewFilter = 'all' | 'needs-review'`.
- `parseSearch(q)` → `{kind:'jump',questionNumber}` (trimmed all-digits) | `{kind:'text',text}` | `{kind:'none'}`.
- `isUnresolvedFlag(row, resolutions)` — flagged AND no valid resolution (drives badge, filter, count).
- `filterReviewRows(reviewRows, filter, search, resolutions)` — filter first, then case-insensitive text match over question + options. A jump query does NOT filter; `jumpIndex(filteredRows, n): number|-1` resolves the target. Jump target hidden by active filter → aria-live hint (`reviewMessages.jumpHiddenByFilter`), never silently clear the filter.

### 3. Detail view — `src/screens/ReviewDetail.tsx` (port of ReviewStage)
- Extract `useSourceUrls` (unchanged object-URL lifecycle: one decoded page at a time, revoked on move) + `useOffline` + key-target helpers into `src/screens/useSourceUrls.ts`, typed against `ReviewRow`.
- Props: `{ run, orderedRows, currentRowId, resolutions, onNavigate(rowId), onBack, onExport, exported }`. `orderedRows` IS the filtered list order; ←/→ walks it. If live resolution updates would remove the current row from the filtered set, the session pins it back at its original position (no content yanked mid-view).
- Confirm ported as-is (saveResolution, tick, advance to next unresolved, wrap). Completion panel (`review-done`) only when filter is `needs-review` and all resolved; under `all`, confirm just advances.
- Keyboard model unchanged (1–9 / Enter / ←/→ / V / W). Header: "Question X of Y" in filtered order; flag badge only when `category !== null`.
- Migrate ReviewStage's hardcoded strings to `reviewMessages` (messages.ts is the single copy source; ReviewStage currently violates it).

### 4. Virtualized list — `src/screens/ReviewList.tsx` + `src/screens/review-virtual.ts`
- `review-virtual.ts`: sole importer of @tanstack/react-virtual. Exports `useVirtualWindow({scrollRef, count, rowHeight})` → `{ totalHeight, items:[{index, offsetTop}], scrollToIndex(i, 'center') }`.
- `ReviewList.tsx` (state lifted to session so it survives the detail swap):
  - Header: `questionCount(n)` total, `GlassInput` search (`type="search"`), needs-review toggle (`aria-pressed`, unresolved count).
  - Body: fixed-height `.review-list__viewport` scroll container, spacer at `totalHeight`, ~10 absolutely-positioned rows. `role="list"`; each row a full-width `<button role="listitem" aria-setsize={filtered.length} aria-posinset={i+1}>`.
  - Row: number, one-line truncated question, answer letter via `effectiveAnswer` (or `answerBlank`), warning Badge when `isUnresolvedFlag`.
  - Jump: `scrollToIndex(i,'center')` + transient highlight class (cleared on timeout, `prefers-reduced-motion` respected). Empty filter result → `searchNoMatches`.
  - MEMORY LAW: this file never imports `getPageArtifact` or `pdf/images` — text only.

### 5. Session — `src/screens/useReviewSession.ts` + `src/screens/ReviewExperience.tsx`
- `useReviewSession(runs)`: `activeRunId` (first done run), lazy per-run `ReviewData` cache (JSON only), `resolutions` live query, per-run `{filter, search}` map, `view: {kind:'list'} | {kind:'detail', rowId}`, `scrollStateRef: Map<runId, scrollTop>` (write throttled, restore on mount; Back also `scrollToIndex` + focus the just-viewed row on next frame). Exposes `filteredRows`, `orderedRowsForDetail` (current row pinned), `openRow`, `back`, `openNeedsReview(runId)` (filter='needs-review' + open first unresolved flag's detail — the one-click Review button path).
- `ReviewExperience.tsx`: file switcher (existing generic `TabNav<T>`, only when >1 done run, per-file question numbering) → `ReviewList`; or `ReviewDetail` when in detail view.

### 6. Convert wiring — `src/screens/Convert.tsx`
- Delete `reviewRunId` state + ReviewStage branch. Done (not running): `session.view.kind === 'detail'` → `ReviewDetail` alone (work-area swap); else `DoneStage` (unchanged) + `ReviewExperience` below. `onOpenReview(runId)` → `session.openNeedsReview(runId)`. Zero-flag runs still get the browsable list.

### 7. History wiring — `src/screens/History.tsx`
- Quiet Button `historyMessages.reviewAction` on `status==='done'` cards → swap card list for `ReviewExperience` (`runs=[run]`) + back; `onExport` reuses existing `exportRun(run,'with-answers')`; `exported = run.exportedAt !== undefined`. Missing blueprint region already degrades to "no source image" copy in detail.

### 8. Copy — `src/copy/messages.ts`
`reviewMessages`: `questionCount(n)`, `searchLabel`, `searchPlaceholder`, `searchNoMatches`, `jumpHiddenByFilter`, `needsReviewFilter(n)`, `showAllFilter`, `fileSwitcherLabel`, `answerBlank`, `backToList`, `questionPosition(cur,total)`, `listPanelLabel`, + all strings migrated from ReviewStage (confirm/prev/next/viewSource/backToAnswer/wholePage/keyboardHint/sourceUnavailable/sourceAlt/pageCaption). `historyMessages.reviewAction`. Match the file's plain-English tone.

### 9. CSS — `src/design/components/components.css`
New classes (tokens.css values only): `.review-list`, `__header`, `__tools`, `__search`, `__filter`, `__count`, `__viewport`, `__spacer`, `.review-list-row` (+ `--flagged`, `--highlight`, `__num`, `__text` single-line ellipsis, `__answer`), `.review-file-tabs`. Existing `.review*`, `.review-option*`, `.review-paper*`, `.review-done*` reused verbatim by ReviewDetail.

### 10. Delete `src/screens/ReviewStage.tsx` (only Convert imported it).

## Tests

- Extend `src/screens/review-data.test.ts` (fake-indexeddb pattern): ReviewRow for every row; unflagged → `category: null` with real pageIndex/box; `flaggedRows` parity; `effectiveAnswer` override/validation.
- New `src/screens/review-filter.test.ts` (pure): `parseSearch` digits/text/empty/whitespace; `filterReviewRows` (resolutions honored, option-text match, filter+text combined); `jumpIndex` present/absent/filtered-out; `isUnresolvedFlag` (resolved flag not shown flagged).
- E2e: one journey in `e2e/critical-journeys.spec.ts` (existing mocked-Gemini pattern): finish run → list under summary → type number → highlight → open row → pick + Enter → back → filter/scroll preserved.

## Sequencing

0. `review_plan.md` at repo root (this plan's content).
1. review-data generalization + tests → 2. review-filter + tests → 3. ReviewDetail/useSourceUrls extraction → 4. `npm i @tanstack/react-virtual` + review-virtual + ReviewList + CSS + copy → 5. session + ReviewExperience → 6. Convert wiring, delete ReviewStage → 7. History wiring → 8. e2e journey.

## Verification

- `npm test` (vitest) green, `tsc` strict clean, lint clean.
- Drive the real app (dev server + Playwright MCP or e2e): finished run shows list below summary with correct total; "140" jumps + highlights; text filters; needs-review filter count matches heading; open unflagged row, change answer, confirm → badge/count updates; Back restores scroll + filter; multi-file batch shows switcher with per-file numbering; History done card → Review answers → crops + whole page render; keyboard-only pass through list and detail.
- Memory check: list scrolling triggers zero `runArtifacts` page reads (text only); detail holds one decoded page at a time.

## Risks

- Virtualized a11y: `aria-setsize`/`aria-posinset` required (only ~10 rows in DOM); focus after Back must wait for the virtualizer to render the target row.
- Vanishing-row-under-filter handled by pinned current row.
- NEVER-GUESS: display via `effectiveAnswer`; writes only via explicit Confirm → `saveResolution`; export path untouched.
