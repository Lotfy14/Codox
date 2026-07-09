# Codox — Product & Decision Context for the Rebuild

_Audience: AI agents working in the new Codox repository. This file is the
context payload for re-deciding the tech stack, UI/UX, and other additions.
Written 2026-07-08 from the CodoxSandbox repository (the product's design/
research repo, formerly named Triviadox-Conv). Codox is the product formerly
named Lucy — older documents and results use that name interchangeably._

_Companion file: [CODOX_MIGRATION.md](CODOX_MIGRATION.md) carries the artifacts
that migrate **as-is** (the Planner-Worker-Audit engine semantics, its three
prompts, and the Triviadox output contract). This file describes; that file
prescribes._

---

## 0. How to read this file (agent instructions)

- **Sections 1–5 are fixed.** Product definition, users, hard rules, input
  space, and output contract are settled. Do not re-open them.
- **Sections 6–9 are prior decisions with rationale.** The tech stack, UI/UX,
  and architecture shell were decided once (v2 PRD, 2026-07-08) but are being
  **re-decided in the new repo**. Treat them as the strongest known candidate
  plus the reasoning that produced it — not as constraints. When you propose
  something different, your proposal must still satisfy the *constraints and
  facts* listed there (those are platform reality, not preference).
- **Section 10 is measured evidence.** Numbers from real experiment runs.
  Never contradict them from intuition; if a decision needs a number that
  isn't here, say the number is unmeasured.
- **Testing does not migrate.** The gold suite, the eval/scoring harness, the
  degraded-input corpus, and the v1 Python reference engine all stay in
  CodoxSandbox. The new repo's output CSVs are graded *there*. Do not rebuild
  or duplicate the test harness in the new repo.
- The implementation language and libraries in the new repo **may differ**
  from anything named here. Nothing in the engine semantics
  (CODOX_MIGRATION.md) depends on a language.

## 1. What Codox is

Codox is a **free app for non-technical users (tutors, students)** that
converts exam PDFs into **Triviadox-ready CSV bundles**. It reads questions,
options, and answers — including scanned pages, circled/ticked answers,
handwritten keys, and clinical figures — and **never silently guesses an
answer**: anything uncertain is emitted blank and flagged for human review.
Triviadox is the separate quiz platform that imports the CSV; its import
schema is ours to change and is pinned by the output contract
(CODOX_MIGRATION.md §3).

The value chain: a tutor has a folder of messy exam PDFs → drops them into
Codox → declares where the answers are → gets, per PDF, a portable bundle
(`questions.csv` + an `images/` folder of cropped figures) → imports it into
Triviadox, where every answer is either correct or explicitly queued for the
tutor's review.

## 2. Users

Non-technical tutors and students, on whatever device they have (Windows
laptop, Android phone, iPhone, any browser). No terminal, no store account, no
technical vocabulary. They can follow a short guided setup and a review
screen, nothing more. Every design decision is filtered through: *would a
tutor with no technical skill get through this unaided?* The audience is
targeted and known — files and links are shared directly with them, not
published to app stores.

## 3. Hard rules (non-negotiable, survive any rebuild)

| Rule | Meaning |
|---|---|
| **COST-ZERO** | $0 recurring cost to the developer. Free hosting, no stores, no signing certificates, no paid dependencies, no developer-paid API usage. Anything with a price must be flagged to the human and worked around by default. |
| **NEVER-GUESS** | Never emit a guessed `correct_index`. Any ambiguity → blank value + `needs_review` flag. A confidently wrong medical answer shown to a student is strictly worse than a blank one. This rule has teeth at every layer: prompts forbid it, deterministic code enforces it, and the audit gate checks it. |
| **PRIVACY-TOLD** | The user's PDF pages go **directly from their device to the LLM provider** using **their own API key** — never through a Codox-operated server. The consent notice states plainly that full page images are sent to the provider and that free tiers may train on the data. Keys are stored only on the user's device. |

Derived invariants that must also survive:

- A wrong user input (e.g. declaring "answers inside the PDF" when there are
  none) must never produce a wrong CSV — it degrades to "everything flagged."
- One bad page never crashes a job — it flags and continues.
- `id` is unique per PDF, not globally; batch imports must namespace per file.
- Image references are **relative paths** into the bundle's `images/` folder
  with human-readable filenames; the bundle must survive being moved.

## 4. The input space (what the engine must handle)

Four **answer forms**, declared by the user at upload (the engine never has to
guess the form, but a wrong declaration must degrade safely):

1. **Separate answer grid/key** — printed key pages at the end of the PDF,
   joined to questions by (section, question number).
2. **Inline marks** — tick / checkmark / circle / highlight / underline /
   handwritten note directly on the question pages. Real documents carry
   *conflicting* marks (a highlight and a tick disagreeing); two disagreeing
   sources → blank + flag unless the document itself says which governs.
3. **Handwritten key** — best-effort read with a tightened legibility bar;
   any doubt → flag.
4. **Questions only** — no answer evidence exists; every `correct_index` is
   blank by construction, flagged `no_answer_key`.

Three **fidelity classes**: clean digital text (has a text layer), scanned
pages (no text layer), and photo-of-screen (glary phone photo of a monitor —
the measured worst case). Plus **figures**: clinical photos / x-rays that must
be cropped out and attributed to the right question(s), including case-based
pairs of questions sharing one image and one stem (`group_id`).

Out of scope (v2): Arabic / RTL / non-English languages (detect and flag
"unsupported," never silently corrupt); quiz-taking or editing beyond the
review step; offline *conversion* (reading pages requires the cloud LLM;
review/export of an already-converted bundle should work offline).

## 5. Output (summary — the authoritative contract migrates as-is)

One bundle per PDF: `Triviadox_output/<pdf-name>/` containing `questions.csv`
plus a sibling `images/` folder, delivered as a zip download (universal) or
written to a user-chosen folder where the platform supports it. The CSV core
is 9 columns:

`id,group_id,topic,subtopic,year,question,options,correct_index,image_urls`

plus an optional 10th `needs_review` column carrying the flag *reason*. Blank
`correct_index` is the hard review signal. `options` is a JSON array in one
CSV cell; `image_urls` is a JSON array of relative paths. True/False questions
are `options=["True","False"]` with a normal 0-based index. Full parsing
rules, semantics, and the definition of "compatible" are in
CODOX_MIGRATION.md §3 and are **not open for redesign**.

Correctness bar: the clean *Acute Appendicitis* sample must reproduce
**127/127 rows exactly** against its gold CSV (graded by the harness that
stays in CodoxSandbox).

## 6. Prior UX design (open for redesign — preserve the intent stated per item)

The v2 PRD specified **five screens**. Each carries a reason; a redesign may
change the surface but must keep the reason satisfied:

1. **Setup (first run)** — paste ≥1 free API key; deep link to each provider's
   key page; paste-and-validate with a live test call; green check or
   plain-English failure. *Intent:* key onboarding is the #1 drop-off risk for
   this audience; a known refinement (BLIND-SPOTS #12) says ask for **exactly
   one key first** and defer "add more keys for higher limits" to an optional
   later step — never four equal-weight fields on first run.
2. **Upload** — one drop zone (1..n PDFs) plus a single declaration question:
   *Where are the answers?* (inside the PDF / in a separate file → second drop
   zone appears / there are no answers). *Intent:* the declaration routes the
   engine's prompts and resolve path so the engine never guesses the answer
   form; smaller single-job prompts are cheaper and more accurate. A wrong
   declaration must never produce a wrong CSV.
3. **Progress** — per-file and overall progress, quota-aware pacing,
   pause/resume. *Intent:* free-tier quota exhaustion mid-PDF must read as
   "paused, resumes when quota allows," never as "the app broke." A dropped
   connection resumes, not restarts.
4. **Review** — every flagged row (blank `correct_index`, low confidence,
   length mismatch, source conflict) shown with the **source crop** beside it;
   the user sets or corrects the answer; keyboard-navigable; works offline on
   an already-converted bundle. *Intent:* the review screen is where
   NEVER-GUESS pays off — the human resolves exactly what the engine refused
   to guess, with the evidence in front of them.
5. **Export** — zip download universally; write-to-folder where supported.
   *Intent:* **export early, export often** — browser storage (especially iOS)
   can evict unexported work, so the app must never be the sole holder of a
   user's work; nudge loudly, or export automatically when review completes.
   On phones, prefer the OS share sheet over a bare zip download where
   supported (BLIND-SPOTS #13: a zip in Downloads is an awkward deliverable
   for a non-technical phone user).

Accessibility note that shaped a prior stack rejection: the review screen must
be a real-DOM, keyboard-navigable UI (Flutter-web was rejected partly on this).

## 7. Provider & key model (facts + prior design)

**Design:** each user brings their own free-tier API key(s). Multiple
providers supported; the engine walks a provider chain and **hot-swaps on
quota/failure mid-PDF**; more keys = more combined free daily quota. Adapters
are thin — the candidate providers are all roughly OpenAI-compatible.
Latency-insensitive batch work may use provider batch APIs where free.

**Measured facts (2026-07-08, from browser context — re-verify if the new
stack is not browser-based):**

- **Gemini's API is CORS-blocked for direct browser calls** (verified). In a
  browser architecture it participates only via a stateless free-tier
  Cloudflare Worker relay (pass-through, no logging/storage) or drops out.
- **Groq and OpenRouter (`:free` models) accept direct browser calls.**
- **NVIDIA NIM browser CORS is unverified.**
- Prior chain order: Groq → OpenRouter `:free` → NVIDIA NIM → Gemini
  (relay-only). CORS policy is the provider's choice and can change silently;
  the chain must re-verify reachability at startup and the UI must distinguish
  "provider unreachable, trying next" from "your key is wrong" — otherwise
  every CORS breakage is misdiagnosed as a key problem (BLIND-SPOTS #9).
- A native (non-browser) runtime is not CORS-bound at all — if the new stack
  has a native network layer, the Gemini relay question disappears. This is a
  real lever in the stack re-decision.

**Consent:** before the first cloud call, a plain notice: full page images go
to the provider under the user's key; free tiers may train on the data; the
key lives only on this device.

## 8. Platform & distribution constraints (facts, not choices)

- **No app stores** — files and links are shared directly with the targeted
  audience. $0 fees, no review processes, instant updates.
- **Windows:** unsigned installers trigger a SmartScreen "protected your PC"
  prompt; acceptable (signing costs money — COST-ZERO). Double-click install
  works.
- **Android:** direct `.apk` installs work after a one-time "install from
  unknown sources" setting. No Play fee, no 12-tester gate.
- **iOS (Apple-imposed):** installing an app *file* on iPhone outside the App
  Store/TestFlight requires a paid ($99/yr) developer account, on **any**
  framework. The only free install path is the browser PWA: Safari → Share →
  "Add to Home Screen" — and Safari never prompts for this itself, so the
  landing page needs a visual 2-step guide. Revisit the $99/yr path only on
  real demand.
- **iOS PWA storage eviction:** Safari can evict PWA storage (IndexedDB/
  Cache) after weeks of disuse — unexported work simply vanishes. This is why
  export-early is a hard UX requirement, not a nicety (BLIND-SPOTS #10).
- **Mobile memory ceilings:** a 25-page scan at 300 DPI is ~825 MB if all
  pages are rasterized at once — mobile browsers kill the tab. Page-at-a-time
  rendering (render → send → release) is mandatory, not an optimization.
- **macOS:** shipping a native Mac app non-scarily requires notarization
  ($99/yr) — violates COST-ZERO; the prior answer was "macOS uses the
  web/PWA path." Any stack re-decision inherits this constraint.
- **No local OCR in a browser:** browsers cannot reach OS-native OCR
  (measured at 91–97% word accuracy in v1), and browser-runnable OCR
  (RapidOCR-class) measured ~53% word-for-word — below the quality bar. In a
  browser stack, **all page reading is LLM-based**. A native stack could
  reopen the OS-OCR option; that trade (quota burn vs. platform reach) is
  quantified in section 10 and BLIND-SPOTS #8.

## 9. Prior tech-stack decision (v2 PRD, 2026-07-08 — open for re-decision)

The stack below was "locked" in the v2 PRD and is now **explicitly re-opened**
for the new repo. It is the benchmark to beat, with each choice's rationale:

| Layer | Prior choice | Why it was chosen |
|---|---|---|
| App | TypeScript + React + Vite | largest ecosystem / AI-assistance corpus; real DOM (accessibility, keyboard-navigable review) |
| Desktop/mobile shell | Tauri 2 | wraps the *same* web build into a real Windows `.exe`/`.msi` and Android `.apk` — one codebase, three shells, no UI fork |
| PWA (web + iOS) | manifest + service worker | browser-installable where Apple blocks file installs; offline review/export |
| PDF render/text/crop | pdfium-wasm | same engine class as v1's pypdfium2, so rendering behavior carries over |
| Zip export | client-side archiver (fflate-class) | MIT, no server |
| Multimodal | user-keyed provider chain (§7) | free tiers, COST-ZERO |
| Hosting | Cloudflare Pages | free, unlimited bandwidth |
| Relay (only if kept) | Cloudflare Worker free tier, stateless | $0; only exists because of Gemini's browser CORS block |

Known caveats attached to that decision (must be answered by any successor):

- **Tauri mobile is "stable, not first-class"** per its own docs — the plan
  required a P1 spike proving a clean Android `.apk` before building on it,
  with Capacitor-for-Android as the named fallback (BLIND-SPOTS #11).
- Rejected alternatives on record: **Flutter-web** (no real DOM →
  accessibility), **local OCR of any kind in-browser** (measured quality,
  §8), **Electron-class bundles** implicitly by the thin-shell requirement,
  and v1's **Python desktop app** (superseded; a 300–600 MB Python+OCR bundle
  was itself a documented adoption barrier).
- The single most decision-relevant unmeasured number: **LLM calls / quota
  consumed per real 25-page scan**, and whether 2–3 free keys' combined quota
  survives it (BLIND-SPOTS #8, rated the one number that could force a
  redesign). Measure it before building deep, whatever the stack.

Prior phasing (P0 docs → P1 skeleton+shells spike → P2 easy screens + pure
logic ports → P3 PDF+AI reader end-to-end → P4 hard inputs + review screen)
is a reasonable template but not binding on the new repo.

## 10. Empirical evidence log (measured, decision-relevant)

All runs are archived in CodoxSandbox under `results/` with per-run metrics;
scores use the strict exact-match grader against the pinned gold suite (four
PDF↔gold pairs: clean digital appendicitis 127 rows with separate key; two
scanned IM exams, 50 rows with conflicting tick+highlight marks and 30 rows
with clean inline circles; dermatology photo-of-screen, 20 questions in 10
image-sharing case pairs, answers best-effort because the key was lost).

1. **Phase 0 (2026-07-03) — raw one-shot, native PDF to `gemini-3.1-flash-lite`,
   clean appendicitis PDF:** emitted all 127 rows but scored **119/127 with 4
   confidently wrong answers**. Verdict: a raw single prompt is not shippable.
2. **Phase 0b (2026-07-03) — staged 9-stage single-call prompt, same model/PDF:**
   raw import score failed on formatting (option labels leaked into text,
   section-local IDs duplicated), but the label-stripped diagnostic showed
   **0 confident wrong answers, 2 safely flagged blanks, 4 formatting
   drifts**. Verdict: in-prompt structure achieves *safety*; formatting/IDs
   must be owned by deterministic emit code, not the model.
3. **NVIDIA free-model bench (2026-07-04) — all 6 free NVIDIA multimodal
   models, full corpus, fixed prompt:** no model produced a usable result on
   the 15-page appendicitis (context windows, 8–12-image caps, timeouts, one
   full provider outage); best (kimi-k2.6) got 30/30 on one scanned exam and
   40/50 on another but was slow and produced 1 confidently wrong answer.
   Notably **no model ever hit an HTTP 429** — free-tier throughput limits,
   not daily quotas, were the binding constraint. Verdict at the time: free
   LLMs can read exam pages but couldn't replace the local path wholesale.
4. **Two-model planner/worker derm tests (2026-07-05, Gemini_Test_1–5 +
   gemini_two_model):** on the hardest input (photo-of-screen, no key),
   structure was solved — 20/20 rows, all 10 case groups matched the gold
   pairing, all 10 vision-bbox crops valid. Remaining failures: **option-text
   transcription drift** (dropped/substituted option strings) and, in one run,
   the model **hallucinated `answer_key_present=true` and filled answers** —
   including 1 wrong answer. Verdict: structure/grouping/crops are provable;
   transcription fidelity and answer-policy enforcement must be guarded by
   deterministic code and an audit gate — which is exactly what the migrated
   Planner-Worker-Audit design does.
5. **LLM-only Planner-Worker-Audit protocol (2026-07-08):** designed and
   hardened (see CODOX_MIGRATION.md), **not yet executed** as of this file's
   writing. Its 4-PDF × 3-run execution matrix, safety classification, and
   audit-accuracy measurement run in CodoxSandbox.
6. **v1 OCR measurements (for the record):** OS-native OCR 91–97% word
   accuracy; RapidOCR-class portable OCR ~53%. This is the measured basis for
   "no local OCR in a browser" and for the quota-burn concern if the LLM
   reads every page.

## 11. Risks that must be resolved before deep building (from BLIND-SPOTS v2)

Ranked; #8, #11, #12 were flagged as "resolve before the architecture locks
in around them":

- **#8 Quota burn (High):** LLM-only reading sends every scanned page to the
  cloud; quota-per-25-page-scan is unmeasured. Mitigations in design:
  declaration-routed smaller prompts, multi-key failover, coarse batch calls.
  Measure early and publish the number.
- **#9 CORS drift (Medium):** provider CORS can change silently; needs
  startup re-verification + an error UX distinguishing provider-down from
  bad-key.
- **#10 iOS storage eviction (Medium-High on iOS):** unexported bundles can
  vanish; export-early must be loud or automatic.
- **#11 Tauri Android maturity (Medium):** hard P1 gate — produce a real
  clean `.apk` before anything depends on it; fallback named (Capacitor for
  Android only).
- **#12 Multi-key onboarding (Medium):** first run asks for exactly one key;
  more keys are a deferred optional step.
- **#13 Zip on phones (Medium):** prefer the OS share sheet on mobile; zip is
  the fallback, not the mobile default.

## 12. Open decisions (carried into the new repo)

- **Gemini: relay vs drop** — decide by measuring whether the non-Gemini free
  quotas alone sustain a 25-page scan; if yes, drop the relay and with it the
  last server component. (Moot if the new stack is native.)
- **NVIDIA NIM CORS** — verify when relevant.
- **Flag-rate ceiling** — set from the first real measurement on hard inputs,
  not guessed; a nonzero rate is *correct* (genuinely ambiguous marks should
  flag), the target is "low enough to still feel automatic."
- **iOS App Store ($99/yr)** — out of scope unless real demand appears.
- **Tech stack / UI/UX** — the subject of the new repo's first decision pass,
  per this file.

## 13. Division of labor between the two repos

**Stays in CodoxSandbox (this repo):** the gold suite and its manifest, the
deterministic graders and eval protocol, the degraded-input corpus, all
experiment scripts and archived results, and the v1 Python engine as the
reference implementation / eval oracle. The new repo's candidate CSVs come
here to be scored; a candidate passes when it matches gold exactly
(appendicitis 127/127 is the non-negotiable gate; the IM golds gate
mark-reading; dermatology gates extraction/attribution/grouping — its answers
are best-effort, so never read its answer mismatches as safety failures).

**Migrates with this file:** everything in
[CODOX_MIGRATION.md](CODOX_MIGRATION.md) — the Planner-Worker-Audit engine
semantics, the three prompts verbatim, and the Triviadox output contract.
