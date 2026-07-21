# CLAUDE.md — Codox

Codox converts exam PDFs into Triviadox-ready CSV bundles, entirely
client-side, for non-technical tutors. Read [Docs/CODOX_CONTEXT.md](Docs/CODOX_CONTEXT.md)
for the full product context, [Docs/BUILD_PLAN.md](Docs/BUILD_PLAN.md) for the
current phase, and [Docs/TECHSTACK_RESEARCH.md](Docs/TECHSTACK_RESEARCH.md)
for why each stack piece was chosen.

## Hard rules (non-negotiable)

1. **COST-ZERO** — $0 recurring cost, ever. No paid dependencies, services,
   certificates, or developer-paid API usage. Licenses must be permissive
   (MIT/Apache/BSD) — **never AGPL, never paid/freemium SDKs**. Anything with
   a price: stop and flag it to the owner.
2. **NEVER-GUESS** — the engine never emits a guessed `correct_index`. Any
   ambiguity → blank value + `needs_review` flag. Enforced in deterministic
   code and the audit gate, not just prompts. A confidently wrong answer is
   strictly worse than a blank one.
   *Sole exception (owner-approved 2026-07-13, reshaped 2026-07-17):* the
   opt-in **"Ask AI"** feature of the Review screen (`src/engine/solver.ts`)
   answers from model knowledge — in review only, never inside the engine
   path and no longer at export time. It never modifies `merged-rows`; an
   AI answer reaches a row only when the tutor explicitly approves it,
   becoming an ordinary review resolution. Exports have no variants
   (owner-approved 2026-07-17): the Export button always ships the
   questions exactly as they stand in review — blank, tutor-answered, or
   AI-approved — to the destination chosen in Customize (Triviadox by
   default, ZIP optionally). The extraction engine itself still never
   guesses.
3. **The key stays on-device** — each user brings their own Gemini API key;
   calls go directly from their device to Gemini. No Codox-operated server ever
   sees a key or a page. First run shows a one-line notice that pages are
   sent to Gemini under the user's key (owner chose minimal notice —
   users are a known group working with public documents).
4. **Claude orchestrates, GLM codes** — in this repo Claude plans and
   reviews; it never writes or edits application code itself, and never
   hand-fixes a bug. Every code change goes through GLM via the `opencode`
   CLI (the `delegate-to-opencode` skill): Claude writes the spec — what to
   change, where, the constraints from this file, and what "done" looks
   like — GLM executes it as a diff, and Claude reviews the diff against the
   spec and against every other rule in this file. If the diff doesn't pass
   review, Claude sends GLM one precise fix instruction and re-reviews — no
   fixed round limit, keep iterating as long as each round makes real
   progress on the review findings. If a round comes back with the same
   problem unfixed (no progress), stop and surface it to the owner instead
   of writing the fix by hand or looping further. Every `opencode run` is
   time-boxed (hard timeout on the invocation; ~3 minutes with no output
   and no diff = stalled → kill it and re-dispatch fresh, never wait it
   out). Continue a session with `-c` only when the follow-up needs its
   accumulated context; a small fully-specified fix always goes in a fresh
   session — stale sessions are killed, never left running. Scope is
   application code (`src/`, shipped config, build scripts) — Claude still
   reads code, runs tests/builds/git to verify GLM's work, writes specs and
   commit messages, and edits documentation (including this file) directly;
   the line is who holds the pen on application code, not who's allowed to
   touch a keyboard. The **Search before build** research step below is
   unaffected — Claude still researches whether a package exists; if none
   does, GLM writes the hand-rolled implementation, not Claude.

## Provider and quota rule (non-negotiable)

- **Gemini only.** Each installation stores exactly one user-supplied Google
  Gemini API key. Codox has no shared, bundled, developer, fallback, or second
  provider key. Every cloud request uses only the key entered on that
  installation, so one user can never consume another user's Gemini quota.
  The user may replace or remove the key, but cannot pool multiple keys.

## Engine semantics are pinned

The Planner-Worker-Audit engine semantics, its three prompts, and the
Triviadox CSV output contract migrate **as-is** from
[Docs/CODOX_MIGRATION.md](Docs/CODOX_MIGRATION.md). **Never edit the three
prompts or the output contract.** Deterministic code owns all formatting,
IDs, and CSV emission — models only read pages, never format output.
Correctness is graded externally in the CodoxSandbox repo (gold gate:
appendicitis 127/127 exact rows); do not build or duplicate a test harness
for engine output here.

*Model assignment (owner-approved 2026-07-14):* all three roles now run
`gemini-3.1-flash-lite`, deviating from CODOX_MIGRATION §1.2's
`gemini-3.5-flash` planner. Reason: 3.5-flash's free-tier per-minute ceiling
made a single multi-page planner call 429 on its own, stalling real
conversions behind minutes of back-off. The prompts, the output contract, and
the no-fallback rule are untouched — the engine still never swaps a role's
model at runtime. Open cost: Flash-Lite's bounding boxes are weaker, so crop
quality is unverified until the gold gate is re-run.

*Question count is code-owned (owner-approved 2026-07-14):* CODOX_MIGRATION
§1.6's rule "`planned_rows` count equals `document_profile.question_count`" no
longer runs as a validation rule. `question_count` must still BE a number (the
contract shape), but deterministic code emits `rows.length` — the rows are the
product, the count is a number the planner wrote beside them. Only a
**shortfall** is a real signal, and `isUnderExtracted` owns it: fewer rows than
the planner counted skips the repair round entirely (the cheapest way to comply
is to lower the count) and splits the page window instead. The surplus direction
is not an error — rejecting it threw away 17 fully-specified rows over a
profile field that read 15, and stopped a real 30-page run.

*Planner redesign (owner-approved 2026-07-14):* the single Planner prompt is
replaced by INDEX, EVIDENCE / KEY MAP, FIGURE DETECT, and BOX prompts. INDEX
enumerates exam-page question slots without geometry; deterministic code
reconciles identities and assembles the pinned Blueprint. Evidence and figures
are observed separately, and an unresolved page is a visible non-fatal planning
issue rather than a reason to discard clean rows. *(2026-07-17, owner-approved:)*
a BOX_BATCH variant covers several pages per BOX call when the user raises
Customize's "Pages per box request" above 1 — an opt-in accuracy-for-quota
trade; 1 (the default) keeps the original single-page BOX prompt byte-identical.
Question regions are always stamped with the ref's code-known owner page; only
figure pages come from the model, validated against the batch.
*(2026-07-20, owner-approved:)* INDEX window size is Customize's **"Pages per
index request"** (1–10), threaded to `planWindows`; the default stays
`DEFAULT_WINDOW_PAGES` = 10, so engine behaviour is unchanged until a tutor
lowers it. **Lowering it is measured to LOSE questions and fix nothing** — on
the embryology document, 10 pages/window found 64 questions with 9 answered
and 3 pages/window found 57 with 9 answered, because more window boundaries
means more rows dropped in reconciliation (12 duplicate-label drops vs 7). The
knob is retained as a diagnostic, not a recommended remedy; a run that lost
questions should try RAISING it.

*Correction (2026-07-20).* This setting was first shipped on the theory that
INDEX's per-question observations "degrade to a constant partway down a long
response," citing `evidence_state` reading `inline` for refs 1–9 then `none`
for 10–57, with `visible_year` collapsing at the same point. **That diagnosis
was wrong** and is recorded here so it is not re-derived. Rendering the actual
document showed every question carries a printed answer letter in a dedicated
right-hand table column, including the ones marked `none`; and the
`visible_year` collapse was *correct* — the document's Arabic exam-year tags
genuinely stop after question 9. Two unrelated facts coinciding on one page
were misread as one signal. The real defect: `evidence_state`'s vocabulary
(`none`/`inline`/`separate`/`ambiguous`/`illegible`) has no slot for an answer
printed in its own column beside the question — it is not a mark on an option
(`inline`) nor another document (`separate`) — so the model falls back to
`none`, BOX is never asked for an evidence region, and the row ships blank with
a crop that excludes the answer. **Lesson: render the source document before
theorising from model output.**

*Per-page INDEX repair (owner-approved 2026-07-21):* raising the window size
only shrinks the number of tail boundaries where INDEX can under-enumerate — it
never removes the last one, and a normal page (verified by rendering it: seven
plain MCQs, no figure) was dropped at a 3-page window's tail on an IM exam,
lost silently from the output. So after the first reconcile, any page a
manifest said holds questions but that no window owned — a reconcile gap, or
every core page of a window that failed to parse — is re-indexed on its own:
core `[p]`, context `[p-1,p,p+1]` (`repairTargetPages` + the repair loop in
`executor.ts`). A single-page request carries none of the long-response fatigue
that dropped the page, and merges back through the same `reconcileIndexWindows`,
so its page-`p` questions are recovered while any neighbour it re-reads dedups
against the original windows — safe whether the page was omitted or mislabeled.
Gated on INDEX having mostly worked (a run that emitted nothing still falls to
the legacy path, never a call per page); a page still empty after its repair
stays flagged `unreadable_page` — NEVER-GUESS holds, nothing is invented. The
three pinned prompts and the output contract are untouched: repair reuses the
INDEX prompt on a narrower page set. "Pages per index request" stays a
diagnostic knob; the repair is the real remedy for a lost page.

*Worker output split + code-owned assembly (owner-approved 2026-07-15):* the
worker no longer assembles the `question` string. It returns the shared case
stem and the individual prompt as two separate verbatim fields (`case_stem`,
`question`); deterministic code (`merge.ts`) strips each part's printed number
and fills the code-owned `final_format`. This honors "code owns all formatting"
(the worker is the weakest model) and lets the case format change without
touching a prompt. The assembled format itself changed from
`Case stem: {case_stem}\nQuestion: {question_prompt}` to
`{case_stem}\n\n{question_prompt}` — the printed case identity in the stem
("Case 10 …") is kept, the `Case stem:`/`Question:` labels are dropped, and a
blank line separates the two. This edited the pinned WORKER prompt (new SHA in
`PROMPT_SHA256.worker`) and CODOX_MIGRATION §2.2; the legacy format is still
accepted on blueprint input so pre-change checkpoints resume unchanged. **Open:
the external gold gate's case-stem rows must be regenerated to the new format
before the appendicitis 127/127 comparison is meaningful again.**

*Worker chunk split-retry (owner-approved 2026-07-18):* §1.3's "worker chunk
retry is exactly one, then stop" no longer stops the run. A chunk that fails
both attempts bisects into smaller requests (fewer rows, fewer page images —
a genuinely different request) down to single rows; a row that still fails
degrades to an all-blank placeholder row that the existing merge gates flag
(`empty_question`/`incomplete_options`) for Review. `worker_chunk_invalid`
now fires only when **every** row failed (systemic, not "one bad page").
Motivation: an EMLE run lost all 89 clean rows because one chunk drew an
empty (likely safety-blocked) Gemini response twice — an abnormal finish
reason bypasses the controller's transient empty-response retry, and the
old path had no fallback. The WORKER prompt and output contract are
untouched; failure diagnostics now record the finish reason.

*Matching-question policy (owner-approved 2026-07-18):* a true matching
question — one row whose answer is a set of pairings — cannot be carried by a
single-`correct_index` Triviadox row. Customize's **"Matching questions"**
setting picks what happens to it: `split` (**default** — one MCQ per
left-column item, options = the right column verbatim) or `skip` (drop the
row). There is deliberately **no "ship it as printed" mode** (owner call): a
matching row can never be imported as it stands, so leaving it intact was
never a real outcome. Cost: one extra request per run, and only when some
row's text actually mentions matching or pairing — the keyword gate keeps
ordinary exams free. `src/engine/matching.ts` is new
surface **outside the engine path**, solver-style: it runs *after* the audit
gate, so `validateFinalRows` and the audit still see the engine's rows 1:1
against the pinned blueprint — only post-audit rows are reshaped. The three
pinned prompts, the blueprint, and the output contract are untouched. The
model's only job is to name the matching rows and separate the two columns;
deterministic code writes every word of the split row's wrapper and **rejects
any span that is not verbatim in the source row** (`verbatimIn`), so this is
re-shaping, never authorship. Split rows always ship a blank `correct_index`
with a review flag — NEVER-GUESS holds: the pairing was never read off the
page, so it is never invented. Any failure (no candidates, dead call,
unusable response) returns the engine's rows untouched. Split ids are
`{parentId}~m{n}`; `parentRowId` lets Review resolve a split row back to its
parent's source region. Extended-matching stems (one stem, shared option
bank) are explicitly *not* matching questions and are left alone.

*Export projection (owner-approved 2026-07-14):* exported CSVs are a
column projection of the pinned format (`src/export/export-csv.ts`,
CODOX_MIGRATION §3.1): `id`/`group_id` never leave the device;
`topic`/`subtopic`/`year` are conditional per the Customizations settings.
The engine prompts, blueprint `csv_schema`, merge, the in-run `csv`
artifact, and the gold gate are untouched — they keep the internal
10-column format. The topic matcher (`src/engine/topic-matcher.ts`) and
topics-document reader (`src/engine/topic-extract.ts`) are new surface
outside the engine path, solver-style: they never modify `merged-rows`,
deterministic code validates every pick against the user's list, and
unsure stays blank — a wrong topic is worse than a blank one.

*Per-row match validation + post-run editor (owner-approved 2026-07-21):*
the matcher validated a whole 20-row chunk atomically and blanked all 20
if any single row's pick failed — on a 50-question run this silently lost
19 good matches when one row in the first chunk came back bad (rows 1–20
blank, 21–50 matched). `validateMatchChunk` is now **per-row**: a blank
pick is a valid "unsure", a listed topic is accepted, and only genuinely
bad or omitted rows are retried alone; only structural garbage (not JSON,
no `matches` array) still fails the whole response. The one retry re-sends
just the offending rows, and a row still bad after it stays honestly blank
— NEVER-GUESS holds, its neighbours survive. Separately, TOPIC_EXTRACT now
strips count badges beside a topic name (`Cardiology 167` → `Cardiology`),
which cleaned exported labels and was the likely trigger of the chunk
failures. New `RunTopicsPanel` (review) lets a tutor rename/remove a run's
topics and re-match every row against the edited list without re-running
the conversion (`rematchRunTopics` = write `topics-list` + clear
`topic-matches` + `matchRunTopics`); still outside the engine path,
`merged-rows` untouched. `TopicsEditor` also gained **reparenting**
(owner-approved 2026-07-21): a "Make a subtopic of…" picker demotes a
top-level topic (and its own subtopics) under another, and "Make topic"
promotes a subtopic back — so a flat extraction the tutor knows should be
nested can be restructured by hand before converting, not just retyped.

## Ship everywhere or nowhere (non-negotiable)

A fix is not done until it is **committed and pushed to `main`** — that one
push is what ships every channel (auto-release.yml deploys the web app and
cuts the GitHub release the Windows auto-updater feeds from). Channels
update at different speeds: web is automatic within minutes, Windows
auto-updates silently on launch, and Android checks on launch too — it
shows an in-app update banner that downloads the new APK and opens the
system installer, but that needs the user to tap through (and allow
"install from unknown sources" once), so it is **not silent** and can lag
until they accept it. A "works on web, broken on phone" report is usually
an APK whose update the user has not accepted yet — or, across the
pre-v0.0.51 signing-key boundary, one that must be uninstalled once before
it can upgrade (`/releases/latest` is the manual APK fallback) — not a code
fork. Never deliver
a fix as a local-only `wrangler deploy`, a hot edit on one machine, or a
change to one device's stored data: that repairs a single installation and
leaves every other device broken. If a fix genuinely cannot ship through
`main` (e.g. it requires clearing per-device state like the service-worker
cache or IndexedDB), say so explicitly and list which devices remain
affected and what the user must do on each.

## Search before build

Before implementing any non-trivial functionality from scratch, dispatch a
**Claude Sonnet 5 research subagent** (Agent tool, model `sonnet`, web search
enabled) to check whether a maintained package already does it. Adopt the
package when it is maintained, permissively licensed, and reasonably sized;
only when the search comes back empty does GLM hand-write the
implementation (per the **Claude orchestrates, GLM codes** rule above —
Claude specs it, doesn't write it). Goal: minimize hand-written code.
Trivial glue (a loop, a small helper) needs no search.

Already-decided packages (do not re-litigate): React 19 + Vite +
vite-plugin-pwa, Dexie (IndexedDB), @hyzyla/pdfium (render/crop), pdf.js
(text layer only), fflate (zip), Tauri 2 (Windows shell), Capacitor
(Android shell).

## Stack & conventions

- TypeScript, strict mode. One web codebase; Tauri/Capacitor are pure
  wrappers — **no per-platform UI forks or behavior forks.**
- The running app is the only design artifact; UI approval means owner
  click-through in the app, never a standalone HTML mockup. Every visual
  value comes from `tokens.css`, and every shared pattern is one class in
  `components.css`.
- Real DOM, keyboard-navigable, accessible UI (the Review screen especially).
  Prefer headless accessible primitives (Radix/React Aria).
- **The JPEG encoder is measured, never assumed.** Page encoding is the
  dominant render cost and no single route wins everywhere — measured
  2026-07-19, ms per A4 page at 200 DPI: OffscreenCanvas 174 / DOM canvas 95
  / MozJPEG-WASM 432 on desktop web; 83 / 204 / 417 on the Windows app;
  **8500 / 4109 / 331 in the Android APK**. Canvas is ~4x faster than WASM
  where it works and 26x slower inside Capacitor's Android WebView (a Skia
  bitmap/readback cost, not JPEG maths), and the two canvas flavours trade
  places between the two desktop shells. `src/pdf/encoder-select.ts` therefore
  runs a small sub-second probe once per session and keeps the winner. This is
  deliberately **not** a platform check — there is no `if (android)` anywhere,
  so the no-behavior-forks rule holds, an Android WebView that fixes canvas is
  picked up automatically, and an unmeasured device is never guessed at. The
  probe must warm every candidate before timing any of them: each has one-off
  first-call costs, and warming only some picks the wrong encoder.
- Mobile memory discipline is law: pages render one at a time
  (render → send → release), canvases destroyed immediately after use;
  design target is a ~100 MB working set (iPhone-SE-class).
- Export-early is law: the app must never be the sole holder of a user's
  work; loud or automatic export when review completes.
- One bad page never crashes a job — flag it and continue. There is no
  answer-source declaration: the planner's evidence-based policy is the only
  authority on where answers live; the answer-key drop zone is optional and
  a present key PDF is always attached.
- Provider errors must be distinguishable in the UI: bad key ≠ provider
  unreachable ≠ quota exhausted (quota reads as "paused," not broken).
