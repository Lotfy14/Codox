# Phase 3 — Design decisions (owner-approved, 2026-07-10)

Discussed and decided with the owner before any mockup work. Colors and
logo are **deferred**: the palette will derive from Triviadox's design
system (not yet available) and the logo is owned by the owner — design
with neutral placeholder tokens, swap later.

## Reference feel

Owner-liked reference: Dribbble "Bank Statement Converter" (soft cream
background, floating white cards, one strong accent, calm density).
Take the *feel*, not the content (no pricing/API/marketing surfaces).

## Layout model

- **Dashboard + focused takeover.** One main screen with persistent nav;
  the Review step takes over the full screen (nav collapses) because it
  needs every pixel and keyboard focus — but always with a **minimize**
  control. Never lock the user. Minimized review shrinks to a resume
  card on the dashboard ("bio_exam — 4 flags left, continue").
- Convert tab home state: drop zone + active job + last 3 runs.
- Desktop: left sidebar. Phone: bottom nav bar, same four tabs.

## Navigation

Four tabs: **Convert / History / Keys / Help**.

## First run

Guided one-time walkthrough: add a key → live-validate → one-line
privacy notice → land on Convert. Ever after: straight to Convert.

## Phone Review layout

**Flippable card**: flagged question fills the screen; tapping "view
source" flips to the full-screen page crop, tap back to answer.
(Desktop: crop and question side-by-side.)

## Progress & motion

- **One calm bar** per file + a short status word. The bar advances only
  on real events (a page actually finished) — never a fake timer.
  Status text always states a true stage; quota exhaustion reads
  "paused — resumes when quota allows" as a calm state, not an error.
- Motion: **subtle & purposeful** only — tab transitions, cards easing
  in, bars gliding, a satisfying tick on flag-resolve and export.
  Nothing decorative.

## Theme & language

- **Light + dark**, follow system, manual toggle. Design both from day
  one with placeholder tokens.
- **English-only UI** (exam PDFs themselves can be any language).

## History

- Actions per past run: **re-export bundle, reopen Review, delete,
  re-run conversion**. Re-run requires storing the original PDF —
  make "keep original PDF" a per-run toggle so storage doesn't balloon.
- Retention: **user-configurable** dropdown in a Storage row at the top
  of History — keep until deleted / keep last N runs / auto-clean after
  N days (number field appears when an N option is chosen). Plus a
  storage meter. Trivial to implement (one Dexie setting + cleanup on
  app open).

## Upload & declaration

**File list + batch default**: dropped PDFs appear as rows; one
batch-wide "answers are: inside / key file / none" default, overridable
per row; conditional key-file drop slot under rows declared "key file";
single Start button.

## Export

- **Big button everywhere** (owner choice — no auto-download).
  Mitigations, not nags: an **"not exported yet" badge** on unexported
  runs (dashboard + History) and request persistent-storage permission.
  Rationale: IndexedDB is evictable cache (iOS PWA ~7-day eviction,
  blind-spot #10); the exported zip is the only OS-sacred copy.
- Flags don't gate export: primary "Review N flags", secondary
  **"Export as-is"** always available (blank answers + needs_review
  rows are contract-valid).

## Keys tab

**Provider cards + status**: one card per provider — paste field with
live check, plain-language status chip (working / wrong key / can't
reach / resting until quota returns), drag-to-reorder failover chain,
first card marked "used first".

## Visual character

**Soft cards, compact lists**: airy rounded cards for Convert / Keys /
first-run; denser row layouts inside History and Review where users
scan many items.
