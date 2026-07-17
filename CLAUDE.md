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
issue rather than a reason to discard clean rows.

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
