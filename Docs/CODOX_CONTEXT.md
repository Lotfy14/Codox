# Codox — product context

_What Codox is, who uses it, and the platform facts every design decision has
to survive. This file **describes**; the binding rules live in
[CLAUDE.md](../CLAUDE.md), the shared output contract in
[OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md), and each conversion strategy's
semantics in its own workflow (e.g.
[workflows/Gold/ENGINE.md](../workflows/Gold/ENGINE.md))._

_Originally written 2026-07-08 as the rebuild's context payload. Trimmed
2026-08-02: the "prior decisions, open for re-decision" material (the v2 PRD
stack table, the multi-provider research, the pre-build spike list, the old
research repo's evidence log) went out with the rebuild it was written for —
those decisions are made and the app is built. What remains is the product
definition and the platform constraints, which have not changed._

---

## 1. What Codox is

Codox is a **free app for non-technical users (tutors, students)** that
converts exam PDFs into **Triviadox-ready CSV bundles**. It reads questions,
options, and answers — including scanned pages, circled/ticked answers,
handwritten keys, and clinical figures — and **never silently guesses an
answer**: anything uncertain is emitted blank and flagged for human review.
Triviadox is the separate quiz platform that imports the CSV; its import
schema is ours to change and is pinned by
[OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md).

The value chain: a tutor has a folder of messy exam PDFs → drops them into
Codox → gets, per PDF, a portable bundle (`<pdf-name> Cx.csv` + an `images/`
folder of cropped figures) → imports it into Triviadox, where every answer is
either correct or explicitly queued for the tutor's review.

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
| **PRIVACY-TOLD** | The user's PDF pages go **directly from their device to Google Gemini** using **their own Gemini API key** — never through a Codox-operated server. The consent notice states plainly that full page images are sent to Gemini and that its free tier may train on the data. The one key is stored only on that user's device, and every request consumes only that user's Gemini quota. |

Each installation stores exactly one user-supplied key. There is no shared key
pool, bundled key, developer key, fallback key, or second provider — a user may
replace or remove their key but cannot pool several for quota. When that user's
quota is exhausted the job **pauses** and resumes when Gemini allows requests
again; it never switches key or provider. The full rule, including the runtime
*model* fallback that does not touch it, is in CLAUDE.md.

Derived invariants that must also survive:

- One bad page never crashes a job — it flags and continues.
- `id` is unique per PDF, not globally; batch imports must namespace per file.
- Image references are **relative paths** into the bundle's `images/` folder
  with human-readable filenames; the bundle must survive being moved.
- Provider errors stay distinguishable in the UI: bad key ≠ provider
  unreachable ≠ quota exhausted, and quota reads as "paused," not broken.

## 4. The input space (what the engine must handle)

Four **answer forms**, detected from document evidence alone (changed
2026-07-13, owner-approved: the upload-time declaration question was removed —
the evidence-based `answer_policy` is the sole authority; a separate answer-key
PDF may optionally be attached and is always read when present):

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

What real documents actually do with answers — the layout corpus, and the two
layouts that are structurally hard to read — is
[benchmarks/corpus/ANSWER_LAYOUTS.md](../benchmarks/corpus/ANSWER_LAYOUTS.md).
What a workflow measured on them stays with that workflow
([Gold's](../workflows/Gold/ANSWER_LAYOUTS.md)).

Three **fidelity classes**: clean digital text (has a text layer), scanned
pages (no text layer), and photo-of-screen (glary phone photo of a monitor —
the measured worst case). Plus **figures**: clinical photos / x-rays that must
be cropped out and attributed to the right question(s), including case-based
pairs of questions sharing one image and one stem (such rows share an entry in
`image_urls`).

Out of scope: Arabic / RTL / non-English languages (detect and flag
"unsupported," never silently corrupt); quiz-taking or editing beyond the
review step; offline *conversion* (reading pages requires the cloud LLM;
review/export of an already-converted bundle works offline).

## 5. Output (summary — the contract is OUTPUT_CONTRACT.md)

One bundle per PDF: `<pdf-name> Cx/` containing `<pdf-name> Cx.csv` plus a
sibling `images/` folder, delivered in a PDF-named `Cx.zip` (universal) or
written to a user-chosen folder where the platform supports it. The CSV core
is 9 columns:

`id,topic,subtopic,year,question,options,correct_index,image_urls,needs_review`

The last column carries the flag *reason*. Blank `correct_index` is the hard
review signal. `options` is a JSON array in one CSV cell; `image_urls` is a
JSON array of relative paths. Full parsing rules, the exported projection, and
the definition of "compatible" are in
[OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md) and are **not open for redesign**.

Correctness is judged on real documents, by eye.

## 6. Platform & distribution constraints (facts, not choices)

- **No app stores** — files and links are shared directly with the targeted
  audience. $0 fees, no review processes, instant updates.
- **Windows:** unsigned installers trigger a SmartScreen "protected your PC"
  prompt; acceptable (signing costs money — COST-ZERO). Double-click install
  works. School IT can ban "Run anyway" outright, so the landing page tells
  tutors on managed laptops to use the browser version.
- **Android:** direct `.apk` installs work after a one-time "install from
  unknown sources" setting. No Play fee, no 12-tester gate. Android only
  accepts updates signed by the same key — across a key change the user must
  uninstall first.
- **iOS (Apple-imposed):** installing an app *file* on iPhone outside the App
  Store/TestFlight requires a paid ($99/yr) developer account, on **any**
  framework. The only free install path is the browser PWA: Safari → Share →
  "Add to Home Screen" — and Safari never prompts for this itself, so the
  landing page needs a visual 2-step guide. Revisit the $99/yr path only on
  real demand.
- **iOS PWA storage eviction:** Safari can evict PWA storage (IndexedDB /
  Cache) after weeks of disuse — unexported work simply vanishes.
  `persist()` is a polite request Apple may ignore, and a plain download link
  silently fails inside an installed iOS PWA (the share sheet is the one
  reliable export path there). This is why export-early is a hard requirement,
  not a nicety.
- **Mobile memory ceilings:** an iPhone-SE-class browser tab dies at roughly
  **~100 MB** of working set, with no catchable error — it just crashes. A
  25-page scan at 300 DPI is ~825 MB if rasterized at once. Page-at-a-time
  rendering (render → send → release) is mandatory, not an optimization.
- **macOS/Linux:** shipping a native Mac app non-scarily requires notarization
  ($99/yr) — violates COST-ZERO. Both use the browser/PWA path; do not
  introduce a "desktop app" assumption for them.
- **No local OCR in a browser:** browsers cannot reach OS-native OCR
  (measured at 91–97% word accuracy), and browser-runnable OCR
  (RapidOCR-class) measured ~53% — below the quality bar. In a browser stack,
  **all page reading is LLM-based.**
- **Dependency licence traps** found while choosing the PDF stack, recorded so
  they are not re-evaluated: **MuPDF.js is AGPL-or-pay** and **Nutrient /
  Apryse have no free tier**. Both are COST-ZERO violations. pdfium
  (`@hyzyla/pdfium`, MIT) draws pages and crops rectangles; pdf.js reads the
  text layer.
