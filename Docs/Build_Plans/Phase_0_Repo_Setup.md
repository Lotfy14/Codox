# Phase 0 Build Plan — Repo & Ground Rules

_Audience: AI coding agents. Execution unit: one task at a time, in order.
Parent plan: [../BUILD_PLAN.md](../BUILD_PLAN.md) Phase 0._

## Status

Phase 0 was executed 2026-07-09 (commits `5160a62`, `04d3b2e`, pushed to
`https://github.com/Lotfy14/Codox`). This plan serves two modes:

- **VERIFY mode** (default when repo state already exists): run each task's
  Acceptance checks only; fix any that fail; skip Steps that already hold.
- **EXECUTE mode** (fresh clone / rebuild): run Steps, then Acceptance.

## Global rules binding every task in this plan

1. Read `/CLAUDE.md` before starting. Its hard rules override this plan on
   conflict.
2. **Never run `git commit` or `git push`.** The owner commits manually.
   When a task's output is "changes ready to commit," stop, report the file
   list, and hand off. Tasks below marked `[OWNER]` are owner-manual.
3. Do not create files outside the repo root `/Users/lotfy/Documents/GitHub/Codox`.
4. If any Acceptance check cannot be made to pass, stop and report — do not
   improvise around it.

## Preconditions (check before T0.1)

| Check | Command | Expected |
|---|---|---|
| git installed | `git --version` | exit 0 |
| gh CLI authed (only needed for T0.7) | `gh auth status` | "Logged in" |
| Repo root exists | `ls /Users/lotfy/Documents/GitHub/Codox` | exit 0 |

---

## T0.1 — Initialize git repository

**Objective:** repo root is a git work tree on branch `main`.

**Steps:**
1. `git init` in repo root.
2. If default branch is not `main`: `git branch -m main`.

**Acceptance:**
- `git rev-parse --is-inside-work-tree` → `true`
- `git branch --show-current` → `main`

## T0.2 — Create `.gitignore`

**Objective:** build artifacts and OS noise never enter git history.

**Steps:** write `.gitignore` at repo root containing at minimum:

```
.DS_Store
node_modules/
dist/
```

(Phase 1/2 will append entries for Vite, Tauri `src-tauri/target/`, and
Capacitor `android/` build outputs — do not add them speculatively now.)

**Acceptance (test case):**
1. `mkdir -p node_modules dist && touch node_modules/x.js dist/x.js .DS_Store`
2. `git status --porcelain` → contains **no** line mentioning
   `node_modules/`, `dist/`, or `.DS_Store`
3. Clean up: `rm -rf node_modules dist .DS_Store` (safe: these exact paths
   were created by this test in step 1; do not widen the rm)

## T0.3 — Folder layout

**Objective:** minimal skeleton matching the parent plan.

**Steps:**
1. Ensure `src/` exists (empty is fine; add `src/.gitkeep` so git tracks it).
2. Ensure `Docs/` contains: `CODOX_CONTEXT.md`, `CODOX_MIGRATION.md`,
   `TECHSTACK_RESEARCH.md`, `BUILD_PLAN.md`.
3. Ensure `Docs/Build_Plans/` exists and contains this file.
4. Do **not** create `src-tauri/` or `android/` — those are Phase 2 outputs.

**Acceptance:**
- `ls Docs/` lists the four docs + `Build_Plans`
- `test -d src` → exit 0
- `test ! -d src-tauri && test ! -d android` → exit 0

## T0.4 — Write `/CLAUDE.md`

**Objective:** the ground-rules file every future agent loads. It already
exists; in VERIFY mode confirm all required sections are present verbatim in
intent (wording may vary, content may not).

**Required sections and their non-negotiable content:**

1. **Hard rules** — exactly three:
   - COST-ZERO: $0 recurring, permissive licenses only (MIT/Apache/BSD),
     never AGPL, never paid/freemium; anything priced → stop and flag owner.
   - NEVER-GUESS: no guessed `correct_index`, ambiguity → blank +
     `needs_review`; enforced in deterministic code + audit gate, not prompts.
   - Keys stay on-device: user-owned API keys, device→provider calls only,
     no Codox server; minimal one-line first-run notice (owner decision).
2. **Engine semantics are pinned** — Planner-Worker-Audit semantics, three
   prompts, and CSV output contract migrate as-is from
   `Docs/CODOX_MIGRATION.md`; never edit them; deterministic code owns all
   formatting/IDs/CSV emission; grading happens externally in CodoxSandbox
   (gold gate: appendicitis 127/127); no test harness for engine output here.
3. **Search before build** — before implementing non-trivial functionality,
   dispatch a Claude Sonnet research subagent (web search) for an existing
   maintained, permissively-licensed package; hand-write only if the search
   is empty; trivial glue exempt. Includes the already-decided package list:
   React 19 + Vite + vite-plugin-pwa, Dexie, @hyzyla/pdfium, pdf.js (text
   layer only), fflate, Tauri 2 (Windows), Capacitor (Android).
4. **Stack & conventions** — TypeScript strict; one web codebase, shells are
   pure wrappers, no per-platform forks; real-DOM accessible keyboard-nav UI;
   page-at-a-time memory discipline (~100 MB working-set target);
   export-early; one bad page flags and continues; wrong declaration degrades
   to all-flagged; provider error states distinguishable (bad key ≠
   unreachable ≠ quota-paused).

**Acceptance (test cases):**
- `test -f CLAUDE.md` → exit 0
- Grep smoke tests, all must match: `grep -c "COST-ZERO" CLAUDE.md` ≥ 1;
  `grep -c "NEVER-GUESS" CLAUDE.md` ≥ 1; `grep -ci "search before build"
  CLAUDE.md` ≥ 1; `grep -c "127/127" CLAUDE.md` ≥ 1
- Every relative link in CLAUDE.md resolves: for each `](path)` target,
  `test -e <path>` from repo root → exit 0

## T0.5 — Cross-link integrity across Docs/

**Objective:** no dead relative links in the four docs (they were moved into
`Docs/` after some were written).

**Steps:** extract every relative markdown link target from
`Docs/*.md` (pattern `](<target>)`, ignore `http`/`https`/`#` targets);
resolve each against the linking file's directory; rewrite any that are dead.

**Acceptance (test case):** a shell one-liner or short script that walks all
`Docs/*.md` and `CLAUDE.md` link targets exits with zero dead links. Report
the list of checked targets in the handoff message.

## T0.6 — [OWNER] First commit

**Objective:** history starts with docs + ground rules.

**Agent action:** stage nothing, run nothing. Report that T0.1–T0.5 are
green and list the files ready for commit. The owner runs
`git add` / `git commit` themselves.

**Acceptance (owner-verified):** `git log --oneline` shows ≥ 1 commit
containing `.gitignore`, `CLAUDE.md`, and `Docs/`.

## T0.7 — [OWNER] GitHub repo + push

**Objective:** remote exists and `main` is pushed. Public visibility
(required later for GitHub Releases distribution).

**Agent action:** none beyond reporting readiness. If asked to prepare the
command, provide it without executing:
`gh repo create Codox --public --source . --push`

**Acceptance (owner-verified):**
- `git remote get-url origin` → `https://github.com/<owner>/Codox.git`
- `git status` → "Your branch is up to date with 'origin/main'"

---

## Phase exit gate

All of: T0.1–T0.5 Acceptance green (agent-verifiable) AND T0.6–T0.7
confirmed by owner. On exit, tick the Phase 0 checkboxes in
`Docs/BUILD_PLAN.md` (edit only — owner commits) and report Phase 1 as next.
