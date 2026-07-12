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
3. **The key stays on-device** — each user brings their own Gemini API key;
   calls go directly from their device to Gemini. No Codox-operated server ever
   sees a key or a page. First run shows a one-line notice that pages are
   sent to Gemini under the user's key (owner chose minimal notice —
   users are a known group working with public documents).

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

## Search before build

Before implementing any non-trivial functionality from scratch, dispatch a
**Claude Sonnet 5 research subagent** (Agent tool, model `sonnet`, web search
enabled) to check whether a maintained package already does it. Adopt the
package when it is maintained, permissively licensed, and reasonably sized;
hand-write code only when the search comes back empty. Goal: minimize
hand-written code. Trivial glue (a loop, a small helper) needs no search.

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
- One bad page never crashes a job — flag it and continue. A wrong user
  declaration degrades to "everything flagged," never to wrong CSV rows.
- Provider errors must be distinguishable in the UI: bad key ≠ provider
  unreachable ≠ quota exhausted (quota reads as "paused," not broken).
