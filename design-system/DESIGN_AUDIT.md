# Frontend Design Audit

## Scope

This audit treats `design-system/one-screen-layout.html` as the newest visual
source of truth. It covers the standalone prototype, the current React
frontend, authored CSS, generated output, and installed package styles.

No application code or styles were changed as part of the audit.

## Major Findings

### 1. The new design is not part of the application

The one-screen design is an untracked standalone HTML file. Production still
renders the older scaffold screens, while the existing design gallery and
clickable mockups are development-only.

**Proposed fix:** Implement the one-screen structure using the existing React
components and make it the production shell. Do not copy the prototype HTML
verbatim.

### 2. The prototype creates a second design system

The prototype defines its own colors, typography, radii, spacing, and shadows.
These conflict with `src/design/tokens.css`. Examples include a 22px card
radius instead of 20px, a different muted color, and Plus Jakarta Sans for all
text instead of the established heading/body font pair.

**Proposed fix:** Map every prototype value to the existing semantic tokens.
Add a token only when no existing token represents the design decision.

### 3. Most controls only look interactive

Navigation items are `div` elements, answer selectors are `span` or `div`
elements, the switch and theme options are `div` elements, and the drop zone
is not interactive.

**Proposed fix:** Build the design from the existing `TabNav`, `FileDropZone`,
`Select`, `Toggle`, `ThemeSwitcher`, and button components.

### 4. Display data is hardcoded in multiple places

Storage is written as both `34%` text and `width: 34%`. Filenames, page counts,
file sizes, file count, total pages, and estimated time are manually repeated.
The prototype says `bio_exam.pdf` has 14 pages while shared mock data says 12.

**Proposed fix:** Keep values in one in-memory data structure and render or
compute all display values from it. A database is not required.

### 5. Only the happy state is designed

There are no empty, dragging, invalid-file, missing-key, running, paused,
failed, review, export, disabled, loading, or completed layouts.

**Proposed fix:** Define state-driven variants while retaining the one-screen
structure.

### 6. Responsive behavior is incomplete

The only breakpoint changes the three-column frame into one column. At 760px,
the header is cramped and the storage label and percentage run together. API
and Help move below the entire workflow.

**Proposed fix:** Design a deliberate mobile header and navigation, keep
utilities immediately reachable, stack file-row controls when needed, and test
at 320px, 375px, 768px, and tablet landscape widths.

### 7. Several touch targets are too small

Remove buttons are 30 by 30px, theme options are 26 by 24px, and the visible
switch is 44 by 26px.

**Proposed fix:** Apply the existing 44 by 44px minimum touch-target token while
keeping the visible icons compact.

### 8. Muted text fails contrast

The prototype's `--muted` color provides approximately 4.08:1 contrast on
white and 3.93:1 on the frame. Both are below the 4.5:1 target for normal text.

**Proposed fix:** Use the existing accessible muted-text token or darken the
prototype value.

### 9. The theme control has no functional theme

The prototype contains only a light palette and has no dark overrides or theme
behavior.

**Proposed fix:** Use the existing theme service and semantic tokens. The
control should select system, light, or dark.

### 10. The declared font is not fully available

The standalone page requests Plus Jakarta Sans without loading it. The
application currently ships only its 800 weight, while the prototype requests
600, 650, and 700.

**Proposed fix:** Preserve Plus Jakarta Sans for headings and Inter for body
text, using shipped weights or intentionally adding the missing font files.

### 11. Interaction states are absent

The prototype CSS has no hover, focus-visible, pressed, disabled, or loading
rules.

**Proposed fix:** Reuse the accessible component states and shared focus-ring
recipe already present in the frontend.

### 12. Accessibility semantics are incomplete

The remove buttons have no accessible names. Theme controls have no roles or
labels. The storage meter has no meter semantics, and the visible `label` is not
connected to a real form control.

**Proposed fix:** Add contextual accessible names, native or React Aria
semantics, proper form associations, and meter/progress attributes.

## CSS Findings

### 13. Raw values bypass the prototype's own tokens

`#fff` is repeated despite `--white`. A 99px pill radius appears repeatedly
instead of a full-radius token. Colors such as `#ead9dd`, `#5f4e52`, and
`#6f5e62` are also duplicated as literals.

**Proposed fix:** Use semantic color tokens plus shared spacing, radius, size,
shadow, and layout scales.

### 14. One selector is split inside the same media block

`.rail` is declared once with flex direction and wrapping, then reopened on the
next line for justification.

**Proposed fix:** Combine the declarations into one media-query rule.

### 15. Identical style fragments are maintained separately

`.panel-head span` and `.fsize` have the same declarations. Toggle help and the
start note are also identical. `.btn.ghost` and `.tag.ask` use the same colors.

**Proposed fix:** Group truly identical selectors or apply a shared text/tone
class.

### 16. Dead CSS and unused tokens exist

`.btn.ghost` is never used. `--burg-hi`, `--amber`, and `--emerald` are declared
but never consumed.

**Proposed fix:** Remove them or connect them to a documented component state.

### 17. Class names are globally generic

Classes such as `.card`, `.field`, `.control`, `.switch`, `.btn`, and `.wrap`
can easily collide when moved into the application.

**Proposed fix:** Scope them beneath a layout root or use the existing `ds-*`
component classes.

### 18. The logo and icons are duplicated inline

The complete logo SVG is copied into the HTML despite existing logo assets.
Chevron and remove icons are also repeated.

**Proposed fix:** Reference the shared logo asset and use reusable icon
components.

### 19. Existing frontend selectors have split ownership

Examples include `.ds-select__trigger`, `.ds-status-chip`,
`.ds-file-row__flag`, `.ds-resume-card__continue`, `.mock-review__source`, and
multiple gallery selectors. Their declarations are spread across distant
rules, sometimes overriding earlier declarations.

**Proposed fix:** Consolidate each base selector, use explicit modifier classes,
and reserve separate declarations for genuine responsive overrides.

### 20. Generated and package duplication should not be edited

The 238 CSS files under `node_modules` are Fontsource-generated declarations.
The `dist` directory is generated build output. Their repetition is expected
and is not authored design debt.

**Proposed fix:** Fix authored source files and regenerate builds. Never edit or
manually deduplicate generated and third-party files.

## Verification

- Inspected the new HTML source and rendered it at desktop, breakpoint, and
  narrow viewport sizes.
- Compared prototype values with `src/design/tokens.css`.
- Scanned authored CSS for duplicate selectors, repeated declaration blocks,
  raw values, dead rules, and unused custom properties.
- Compared prototype data with existing mock data.
- Confirmed the existing TypeScript build and lint checks pass; the standalone
  HTML is not currently included in either check.
