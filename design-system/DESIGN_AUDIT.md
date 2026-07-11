# Frontend Design Audit

## Scope

`design-system/one-screen-layout.html` is the newest visual source of truth —
but as a **structural reference only**. It is a static throwaway mockup and
will be deleted once the layout is rebuilt in React. Defects internal to the
prototype file (dead CSS, duplicated literals, fake `div` controls, inline
SVG copies, missing hover/focus rules, generic class names) are therefore not
tracked here: fixing them would be work on a file destined for deletion, and
rebuilding from the existing component library resolves all of them at once.

Note the prototype's own caption claims "colors are the existing tokens" —
this is false (see finding 2). Do not trust the caption; map every value.

Generated output (`dist/`) and package styles (`node_modules/`) are expected
duplication and are never edited by hand.

No application code or styles were changed as part of the audit.

## Findings, in priority order

### 1. Only the happy state is designed

The prototype shows one state: files loaded, key present, nothing running.
There are no empty, dragging, invalid-file, missing-key, running, paused,
failed, review, export, disabled, loading, or completed layouts. Several of
these are project law, not polish: provider errors must be distinguishable
(bad key ≠ unreachable ≠ quota, and quota reads as "paused"), review and
loud/automatic export are core flows, and one bad page must flag-and-continue
visibly.

**Action:** Define state-driven variants of the one-screen structure before
or during the rebuild. This is the largest missing piece of the design.

### 2. Open owner decision blocks the rebuild

The prototype's legend still asks: keep **History** as a left-nav item, drop
it, or fold "last runs" into the Convert screen? (Inline review was already
confirmed 2026-07-11.) The sidebar structure can't be finalized until this is
answered.

**Action:** Get the owner's call on History before building the nav.

### 3. The new design is not part of the application

The one-screen design is an untracked standalone HTML file. Production still
renders the older scaffold screens; the design gallery and clickable mockups
are development-only.

**Action:** Rebuild the one-screen structure as the production shell using
the existing `TabNav`, `FileDropZone`, `Select`, `Toggle`, `ThemeSwitcher`,
and button components — never by copying prototype HTML. Reusing these
components is also what delivers the accessibility, interaction states,
44px touch targets, theming, and semantics the static prototype lacks;
verify each of those in the rebuilt screen rather than assuming them.

### 4. Prototype values must be mapped to existing tokens, not copied

The prototype invents its own colors, typography, radii, spacing, and
shadows, and they conflict with `src/design/tokens.css`: a 22px card radius
vs the 20px token, a muted color (`#8c797e`, 4.08:1 on white — fails
contrast) vs the accessible `--color-text-muted`, Plus Jakarta Sans for all
text vs the established heading/body pair (the app ships only PJS 800 and
Inter 400/500; the prototype assumes weights 600/650/700).

**Action:** During the rebuild, map every prototype value to an existing
semantic token. Add a token only when no existing token represents the
design decision. Display data (file names, page counts, sizes, storage %)
comes from `src/mockups/mockData.ts` or real state — the prototype's
hardcoded values disagree with it (14 vs 12 pages, 3.1 vs 4.5 MB) and with
themselves.

### 5. Responsive behavior is incomplete

The prototype's only breakpoint collapses three columns into one. At 760px
the header is cramped, the storage label and percentage run together, and
API/Help fall below the entire workflow.

**Action:** Design a deliberate mobile header and navigation, keep utilities
immediately reachable, stack file-row controls when needed, and test at
320px, 375px, 768px, and tablet landscape widths.

### 6. Existing frontend selectors have split ownership

This is the one finding in real authored app code, so it survives regardless
of the prototype. Examples: `.ds-select__trigger` (components.css:165 and
:217), `.ds-file-row__flag` (:541 and :546), `.ds-status-chip`,
`.ds-resume-card__continue`, `.mock-review__source`, and several gallery
selectors — declarations spread across distant rules, sometimes overriding
earlier ones.

**Action:** Consolidate each base selector, use explicit modifier classes,
and reserve separate declarations for genuine responsive overrides. Worth
doing before the rebuild adds more rules to the same files.

## Verification

- Inspected the prototype HTML and rendered it at desktop, breakpoint, and
  narrow viewport sizes.
- Compared prototype values with `src/design/tokens.css`,
  `src/design/fonts.css`, and `src/mockups/mockData.ts`; contrast ratio
  recomputed independently.
- Confirmed duplicate declarations for the finding-6 selectors in
  `src/design/components/components.css`.
- Confirmed the existing TypeScript build and lint checks pass; the
  standalone HTML is not included in either check.
