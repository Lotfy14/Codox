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

- **One calm bar** per file, with the real fraction/percent shown on
  the bar itself. The bar advances only on real events (a page actually
  finished) — never a fake timer. No separate status line during
  normal running (owner call 2026-07-10: the bar carries the truth,
  the silly-sentence line carries the life). Serious states replace
  the silly line with real words: quota exhaustion reads "paused —
  resumes when quota allows" as a calm state, not an error; failures
  get plain serious text.
- Motion: **subtle & purposeful** only — tab transitions, cards easing
  in, bars gliding, a satisfying tick on flag-resolve and export.
  Nothing decorative.
- **Silly-sentence line (owner request, fun, non-core):** under the
  progress bar, silly sentences type themselves out (typewriter
  animation) from an owner-provided list (~100, plain text, one per
  line). Shuffled, no repeats until the list is exhausted. This is
  the **only** text under the bar during normal running. Paused/error
  states replace it with serious real lines.
  **Rotation is a fixed, calm timer — never tied to engine events,
  progress, or task size** (owner ruling 2026-07-10: event-driven
  switching would flash sentences during fast stretches — eye
  strain). The line is a detached distraction, in the spirit of
  Claude Code's working words; it carries zero information about the
  run. Exact interval tuned during mockups. Sole exception to the
  typewriter: devices with the OS "reduce motion" accessibility
  switch on show the sentence instantly (one CSS line, owner-approved
  2026-07-10).

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
- Owner risk stance (2026-07-10): storage eviction of an unexported
  bundle is an **acceptable, rare cost** — the user still has the PDF
  and simply re-runs it (only completed review work would need
  redoing). Do **not** add eviction warnings or nags beyond the two
  quiet measures: an **"not exported yet" badge** on unexported runs
  (dashboard + History) and a silent persistent-storage permission
  request. Background: IndexedDB is evictable cache (iOS PWA ~7-day
  eviction, blind-spot #10); an exported zip is the only OS-sacred copy.
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

## What is NOT decided yet (simple version — for the owner)

Think of the app like a house we are building. The rooms and furniture
are all decided above. These things are still missing, and here is who
brings each one:

1. **The colors** 🎨 — *waiting on you.*
   The app will use Triviadox's colors, and you don't have them yet.
   Until then, I paint everything in temporary "stand-in" colors.
   **What you do:** when you get the Triviadox colors (even a simple
   list like "main color is #2E7D32"), just paste them to me. I will
   repaint the whole app and make matching light-mode and dark-mode
   versions myself — you don't need to prepare anything else.

2. **The logo** 🖼️ — *yours completely, I never touch it.*
   You said it will look like Triviadox's logo with a Codox identity
   on top. **What you do:** when it exists, send me the image file
   (the bigger/sharper the better — one big square PNG or SVG is
   perfect). I will shrink and place it everywhere it's needed: the
   app icon on phones, the Windows icon, the browser tab, inside the
   app.

3. **The letters (font)** ✍️ — *waiting on the same Triviadox kit.*
   If Triviadox uses a specific font, tell me its name and I'll use it
   (if it's free). If you never find out, no problem — I'll pick a
   clean free font and that's the end of it. Nothing for you to do
   unless you learn the font's name.

4. **The exact words in error messages** 💬 — *my job, then your
   check.* I will write every error a tutor can see in plain English
   ("can't reach the provider, trying the next one"). You just read
   them once and tell me if any sound confusing.

5. **The final "yes it looks right"** ✅ — *your job, at the end.*
   Phase 3 finishes only when you click through the five screens on
   the mockups and say "approved." Nothing is final until you say so.

Everything else in this file is **decided** and I build with it as-is.
