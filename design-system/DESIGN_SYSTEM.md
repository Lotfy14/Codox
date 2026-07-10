# Codox Design System

_Canonical record of the Phase 3A foundation as implemented on 2026-07-10._

This document describes the code in `src/design/` and the development gallery.
It does not claim that the five Phase 3 product mockups or owner sign-off are
complete. Those screens are still integration work; the component APIs and
composition rules below are the contract they must use.

## Identity and feel

Codox uses calm, compact glass surfaces over Triviadox's parchment light base
and midnight dark base, with one strong burgundy action family and distinct,
plain-language status colors. Plus Jakarta Sans gives headings and labels a
confident editorial edge; Inter keeps working copy dense and readable. The
current identity mark is **Neon Scan**, the owner-approved glowing scanner logo
in [`assets/codox-logo.svg`](assets/codox-logo.svg). Its colors and glow are
deliberately independent of the UI palette: never recolor it, derive UI tokens
from it, or treat its neon colors as product status colors. The root and public
logo files are delivery copies of that canonical artwork.

## Tokens

[`src/design/tokens.css`](../src/design/tokens.css) defines the light values and
all shared values on `:root`; `[data-theme="dark"]` overrides only the values
that differ. The tables below list every shipped token. A repeated value means
the token is intentionally theme-independent.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-surface` | `#fff8f7` | `#011a36` | App background: parchment / midnight |
| `--color-surface-elevated` | `#ffffff` | `#0d1117` | Opaque elevated controls and popovers |
| `--color-card-fill` | `rgb(255 255 255 / 88%)` | `rgb(13 17 23 / 75%)` | Theme-resolved card glass fill |
| `--color-outline` | `rgb(128 0 32 / 22%)` | `rgb(255 255 255 / 10%)` | Quiet dividers and card outlines |
| `--color-row` | `#ffffff` | `#12283f` | Solid dense-list rows inside one glass container |
| `--color-row-hover` | `#f7edef` | `#18334f` | Solid hover/focus wash |
| `--color-scrim` | `rgb(43 17 24 / 54%)` | `rgb(0 5 12 / 72%)` | Modal overlay |

### Text, actions, and focus

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-text-strong` | `#2b1118` | `#f8fafc` | Headings and primary copy |
| `--color-text-muted` | `#6f4e57` | `#b8c3d1` | Supporting copy and quiet actions |
| `--color-text-on-primary` | `#ffffff` | `#ffffff` | Text on primary fills |
| `--color-primary` | `#800020` | `#af2b3e` | Primary fills and functional accents |
| `--color-primary-foreground` | `#800020` | `#ff9aac` | Accessible primary-colored text |
| `--color-primary-hover` | `#68001a` | `#c43d51` | Primary hover fill |
| `--color-primary-soft` | `#f7e8ec` | `#381827` | Selected/secondary-action surface |
| `--color-primary-border` | `#bb8291` | `#9f4c5d` | Primary-family outline |
| `--color-control-border` | `#9a5a6a` | `#71869d` | Persistent input/control boundary with at least 3:1 non-text contrast |
| `--color-focus-ring` | `#800020` | `#ff9aac` | Visible keyboard focus outline |
| `--color-focus-halo` | `rgb(128 0 32 / 20%)` | `rgb(255 154 172 / 24%)` | Outer focus halo |

### Semantic feedback

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-warning` | `#f59e0b` | `#f59e0b` | Raw Triviadox amber; graphical timer/warning accent |
| `--color-warning-foreground` | `#6f3d00` | `#fcd34d` | Warning/quota text |
| `--color-warning-surface` | `#fff2d8` | `#352b16` | Warning/quota surface |
| `--color-warning-border` | `#d89218` | `#a97a20` | Warning/quota outline |
| `--color-success` | `#10b981` | `#10b981` | Raw Triviadox emerald; graphical success accent |
| `--color-success-foreground` | `#075e45` | `#6ee7b7` | Success text |
| `--color-success-surface` | `#e6f7f1` | `#062c35` | Success surface |
| `--color-success-border` | `#48a889` | `#278d70` | Success outline |
| `--color-danger` | `#8f1230` | `#fb7185` | Destructive action fill, derived from the burgundy family |
| `--color-text-on-danger` | `#ffffff` | `#2b1118` | Text on destructive fills |
| `--color-danger-hover` | `#720d26` | `#f98a9a` | Destructive hover fill |
| `--color-danger-foreground` | `#8f1230` | `#fb7185` | Error/wrong-key text |
| `--color-danger-surface` | `#fde8ed` | `#3b1726` | Error/wrong-key surface |
| `--color-danger-border` | `#cb8295` | `#a7475d` | Error/wrong-key outline |
| `--color-unreachable-foreground` | `#365b7a` | `#c8d5e4` | Provider-unreachable text |
| `--color-unreachable-surface` | `#edf3f8` | `#12283f` | Provider-unreachable surface |
| `--color-unreachable-border` | `#91a9bc` | `#496782` | Provider-unreachable outline |
| `--color-neutral-surface` | `#f4edef` | `#17283b` | Idle/neutral surface |
| `--color-neutral-border` | `#94717b` | `#617991` | Idle/neutral outline with at least 3:1 non-text contrast |

Raw amber and emerald are preserved for provenance and graphical accents. Do
not put small text directly in `--color-warning` or `--color-success`; use each
semantic foreground/surface pair. Wrong key, unreachable, and quota-paused
have separate danger, blue-neutral, and amber families so color reinforces the
words without carrying the meaning alone.

### Glass colors

| Token | Light | Dark | Use |
|---|---|---|---|
| `--glass-panel-background` | `var(--color-card-fill)` → `rgb(255 255 255 / 88%)` | `var(--color-card-fill)` → `rgb(13 17 23 / 75%)` | Panel glass fill |
| `--glass-panel-border` | `var(--color-outline)` → `rgb(128 0 32 / 22%)` | `var(--color-outline)` → `rgb(255 255 255 / 10%)` | Panel glass outline |
| `--glass-input-background` | `rgb(255 255 255 / 58%)` | `rgb(255 255 255 / 2%)` | Input glass fill |
| `--glass-input-border` | `var(--color-control-border)` → `#9a5a6a` | `var(--color-control-border)` → `#71869d` | Persistent input/control boundary |
| `--glass-panel-fallback` | `#ffffff` | `#0d1117` | Opaque panel fallback |
| `--glass-input-fallback` | `#fffafa` | `#132238` | Opaque input fallback |

### Typography

| Token | Light | Dark | Use |
|---|---|---|---|
| `--font-family-heading` | `"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif` | Same | Headings and tracked labels |
| `--font-family-body` | `"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Same | Body and controls |
| `--font-weight-regular` | `400` | `400` | Body copy |
| `--font-weight-medium` | `500` | `500` | Controls and emphasized body copy |
| `--font-weight-label` | `800` | `800` | Small labels |
| `--font-weight-heading` | `800` | `800` | Headings |
| `--font-size-xs` | `0.75rem` / 12px | Same | Metadata, status chips, labels |
| `--font-size-sm` | `0.875rem` / 14px | Same | Supporting copy |
| `--font-size-md` | `1rem` / 16px | Same | Body and controls |
| `--font-size-lg` | `1.125rem` / 18px | Same | Lead copy |
| `--font-size-xl` | `1.375rem` / 22px | Same | Card/dialog headings |
| `--font-size-2xl` | `1.625rem` / 26px | Same | Section/small-screen headings |
| `--font-size-3xl` | `2rem` / 32px | Same | Screen headings |
| `--line-height-tight` | `1.15` | `1.15` | Very compact display lines |
| `--line-height-heading` | `1.22` | `1.22` | Headings |
| `--line-height-body` | `1.55` | `1.55` | Body copy |
| `--letter-spacing-label` | `0.12em` | `0.12em` | Uppercase labels |

### Spacing

| Token | Light | Dark | Resolved size |
|---|---|---|---|
| `--space-0` | `0` | `0` | 0px |
| `--space-1` | `0.25rem` | Same | 4px |
| `--space-2` | `0.5rem` | Same | 8px |
| `--space-3` | `0.75rem` | Same | 12px |
| `--space-4` | `1rem` | Same | 16px |
| `--space-5` | `1.25rem` | Same | 20px |
| `--space-6` | `1.5rem` | Same | 24px |
| `--space-8` | `2rem` | Same | 32px |
| `--space-10` | `2.5rem` | Same | 40px |
| `--space-12` | `3rem` | Same | 48px |
| `--space-16` | `4rem` | Same | 64px |
| `--space-24` | `6rem` | Same | 96px |
| `--layout-gap-mobile` | `var(--space-4)` | Same | 16px |
| `--layout-gap-desktop` | `var(--space-8)` | Same | 32px |

### Geometry, interaction, motion, and shadows

| Token | Light | Dark | Use |
|---|---|---|---|
| `--radius-input` | `0.75rem` / 12px | Same | Inputs and compact controls |
| `--radius-chip` | `1rem` / 16px | Same | Chips |
| `--radius-card` | `1.25rem` / 20px | Same | Rows and compact cards |
| `--radius-action` | `1.75rem` / 28px | Same | Buttons/navigation |
| `--radius-dashboard` | `2rem` / 32px | Same | Main glass panels |
| `--radius-dashboard-large` | `2.5rem` / 40px | Same | Large dashboard frames |
| `--radius-full` | `999px` | Same | Pills, bars, round controls |
| `--touch-target-min` | `2.75rem` / 44px | Same | Minimum interactive height/width where applied |
| `--focus-ring-width` | `3px` | Same | Focus outline width |
| `--focus-ring-offset` | `3px` | Same | Focus outline offset |
| `--motion-duration-fast` | `120ms` | Same | Hover and compact control response |
| `--motion-duration-standard` | `200ms` | Same | Screen/dialog entry and toggles |
| `--motion-duration-slow` | `320ms` | Same | Determinate bar glide |
| `--motion-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Same | General transition curve |
| `--motion-ease-emphasized` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Same | Progress, toggle, dialog movement |
| `--glass-panel-blur` | `40px` | Same | Panel backdrop blur |
| `--glass-panel-saturation` | `160%` | Same | Panel backdrop saturation |
| `--glass-input-blur` | `12px` | Same | Input backdrop blur |
| `--glass-input-saturation` | `150%` | Same | Input backdrop saturation |
| `--glass-shadow` | `0 15px 45px -12px rgb(0 0 0 / 15%)` | Same | Glass panels |
| `--shadow-raised` | `0 12px 30px -18px rgb(62 15 29 / 35%)` | `0 14px 34px -18px rgb(0 0 0 / 70%)` | Raised navigation/card elements |
| `--shadow-dialog` | `0 28px 80px -30px rgb(0 0 0 / 55%)` | Same | Modal/popover elevation |

### Contrast notes

The locked base, card, primary, amber, and emerald values were not recolored.
Accessible foreground/surface pairs and the dark focus color were added around
them. The original translucent outline remains available for decorative card
edges, but persistent form/drop-zone boundaries use the stronger
`--color-control-border`; neutral switch/chip borders were strengthened as
well. The following WCAG contrast ratios were checked from the shipped values;
all text pairs exceed 4.5:1 for normal text.

| Pair | Light | Dark |
|---|---:|---:|
| Strong text on base surface | 16.74:1 | 16.69:1 |
| Muted text on base surface | 6.90:1 | 9.79:1 |
| Strong text on composited card fill | 17.44:1 | 17.83:1 |
| Muted text on composited card fill | 7.18:1 | 10.45:1 |
| Text on primary button | 10.83:1 | 6.49:1 |
| Primary foreground on primary-soft | 9.13:1 | 7.88:1 |
| Warning foreground on warning surface | 8.08:1 | 9.65:1 |
| Success foreground on success surface | 7.02:1 | 9.71:1 |
| Danger foreground on danger surface | 7.81:1 | 5.84:1 |
| Text on danger button | 9.14:1 | 6.52:1 |
| Unreachable foreground on unreachable surface | 6.40:1 | 10.06:1 |
| Focus ring on base surface | 10.33:1 | 8.71:1 |
| Control border on glass-input fill over app base (non-text) | 5.09:1 | 4.43:1 |
| Neutral border on neutral surface (non-text) | 3.71:1 | 3.32:1 |

The low-alpha `--color-outline` and shadows are decorative and are not used as
the sole carrier of a control boundary or state. The fixed app background makes
the listed glass composites predictable; if glass is placed over a new
backdrop, recheck the actual composite rather than assuming these ratios
transfer.

## Typography in use

[`src/design/fonts.css`](../src/design/fonts.css) self-hosts three Latin WOFF2
files: Plus Jakarta Sans 800 and Inter 400/500. `font-display: swap` keeps text
available while the local asset loads. No CDN, WOFF fallback, Arabic face, or
synthetic 900 weight is shipped; `font-synthesis: none` prevents invented
weights. Use Plus Jakarta Sans 800 for headings and uppercase labels, Inter 400
for body copy, and Inter 500 for controls/emphasis. Labels use 12px,
`0.12em` tracking, and uppercase styling. Screen headings use the 26–32px end
of the scale, card/dialog headings use 22px, normal body and controls use 16px,
and supporting copy/status text uses 12–14px.

## Surfaces and glass

The implementation resolves the upstream source's two recipes as
theme-specific card fill + outline combined with shared blur, saturation, and
shadow values.

- `.glass-panel` consumes panel background/border, 40px blur, 160%
  saturation, and the glass shadow.
- `.glass-input` consumes input background, the contrast-strengthened control
  border, 12px blur, and 150% saturation. It has no panel shadow.
- Both include `backdrop-filter` and `-webkit-backdrop-filter`.
- An `@supports not` block swaps only the translucent background for the
  theme's opaque fallback. Border, geometry, and layout remain unchanged.
- Glass never stacks. A defensive `.glass-panel .glass-panel` rule removes
  the inner blur and shadow and changes it to `--color-row`, but composition
  should avoid creating that invalid nesting in the first place.
- Dense History, Review, file, and provider lists use solid `--color-row`
  children inside one glass container. Never put `backdrop-filter` on every
  row.
- Fixed/sticky navigation is deliberately solid `--color-row` with the raised
  shadow. `TabNav` does not apply an ad-hoc backdrop filter.

`GlassPanel` adds the shared class, a 32px dashboard radius, and a tokenized
padding choice. `GlassInput` adds field semantics and validation; applying the
raw utility class alone does not create a labelled accessible field.

## Motion

Motion is functional and token-driven. Shipped CSS animations and transitions
touch only transform and opacity: select-chevron rotation, toggle-thumb
movement, determinate bar fill, dialog/screen entry, pending-button rotation,
provider drag opacity, and the Gallery timing sample. Separately,
`TypewriterLine` reveals text through its JavaScript timer. Hover, focus,
drop-target, and semantic color changes are immediate. Phase 3 also permits a
short transform/opacity tick when a flag is resolved or an export completes,
but no standalone tick component is implemented yet. Decorative ambient
motion is not part of the system.

`ProgressBar` is determinate: it renders only the supplied real `value` and
`max`, clamps invalid values, and never owns a timer, shimmer, or fake advance.
Its fill glides for 320ms when real state changes. `TypewriterLine` defaults to
a fixed 8,000ms sentence rotation and 40ms per character. It trims and
deduplicates its input, shuffles without repeats until the deck is exhausted,
and avoids an immediate repeat across deck boundaries. Rotation is independent
of engine events and task size. Serious pause/error copy belongs outside this
component and replaces it on the Progress screen.

The global `prefers-reduced-motion: reduce` rule reduces every animation and
transition to 0.01ms and one iteration. `TypewriterLine` also listens to that
media query in JavaScript, shows the whole sentence immediately, and hides its
caret; its calm sentence rotation and non-live accessibility copy remain.

## Components

All public imports come from
[`src/design/components/index.ts`](../src/design/components/index.ts). The
library uses named exports and strict TypeScript props. “Screen contract” below
records where each component was built to be composed. At this foundation
stage the development Design Gallery is the only screen that mounts the whole
library; Setup, Upload, Progress, Review, and Export remain placeholders.

### `GlassPanel`

- **Props:** `children` (required); `as` = `article | aside | div | main |
  section` (default `div`); `padding` = `none | compact | default | spacious`
  (default `default`); normal element attributes including `className`.
- **States:** four padding states: 0, 16, 24, and 32px; spacious becomes 20px
  at widths at or below 48rem.
- **Accessibility:** the caller chooses the semantic element and supplies any
  heading/label relationship. It adds no role.
- **Screen contract:** shared surface everywhere; demonstrated in Gallery.
- **Do / don't:** use one glass boundary around a section; do not nest glass
  panels or turn every list row into glass.

### `GlassInput`

- **Props:** required `label`; optional `description`, `errorMessage`,
  `successMessage`, `status = default | error | success`, `isInvalid`,
  `inputClassName`, `inputProps`, and `inputRef`; passes the remaining React
  Aria `TextField` props such as `value`, `onChange`, `name`, `type`,
  `isRequired`, `isDisabled`, and `isReadOnly`.
- **States:** default, success, error/invalid, focus, disabled; invalid always
  wins over a supplied success status.
- **Accessibility / keys:** React Aria links label, description, and field
  error to the native input. The browser supplies normal text-editing keys;
  focus uses the global ring. Success copy is polite live text. `FieldError`
  is exposed only when the field is invalid under React Aria's validation
  state.
- **Screen contract:** Keys and Upload; all states demonstrated in Gallery.
- **Do / don't:** put field semantics on `GlassInput`, not in `inputProps`; do
  not signal validity with border color alone.

### `Button`

- **Props:** `children`; `variant = primary | secondary | quiet | danger`
  (default `primary`); `isLoading`; React Aria's synonymous `isPending`;
  `loadingLabel` (default “Working…”); `className`; all other React Aria
  button props, including `onPress`, `isDisabled`, and native button options.
- **States:** default, hover, focus-visible, disabled, and pending/loading.
  Pending remains focusable, sets `aria-busy`, prevents another press through
  React Aria, and replaces the label while showing an aria-hidden spinner.
- **Accessibility / keys:** native button semantics; Enter and Space activate;
  React Aria normalizes pointer, keyboard, and touch presses.
- **Screen contract:** actions everywhere; all variants and pending/disabled
  states demonstrated in Gallery.
- **Do / don't:** use one primary action for the current decision and danger
  only for destructive work; do not use quiet styling for the main export.

### `StatusChip`

- **Props:** required `status`; optional `children` label override; safe span
  attributes. Status is `idle | checking | working | wrong-key | unreachable |
  quota-paused`.
- **States/default words:** “Not checked”, “Checking”, “Working”, “Wrong key”,
  “Can't reach”, and “Resting until quota returns”.
- **Accessibility:** `role="status"`, `aria-live="polite"`, and
  `aria-atomic="true"`; indicator dot is hidden from assistive technology.
  It is non-interactive and has no keyboard behavior.
- **Screen contract:** Keys and Progress; every status demonstrated in Gallery.
- **Do / don't:** keep the default plain-language distinctions; do not turn
  quota pause red or replace the words with color/icon alone.

### `ProgressBar`

- **Props:** required `value`; `max` (default 100); `label`; `showFraction`
  (default true); standard div attributes.
- **States:** incomplete/complete; values clamp to 0…max; non-finite values
  become zero; non-positive/non-finite max becomes 100. With the fraction
  enabled the bar reads `value/max · percent%`; otherwise it reads percent.
- **Accessibility:** the track is `role="progressbar"` with min/max/now,
  a label, and an explicit “fraction, percent” value text. Visible value copy
  is aria-hidden to avoid duplication.
- **Screen contract:** Progress and active-job compositions; incomplete and
  complete examples demonstrated in Gallery.
- **Do / don't:** pass only persisted real-work progress; never drive it with
  a cosmetic timer or use it as an indeterminate loader.

### `TypewriterLine`

- **Props:** required readonly `sentences`; `rotationInterval` (default 8000ms);
  `typingInterval` (default 40ms); paragraph attributes.
- **States:** shuffled deck, typing, completed sentence, empty input, and
  reduced motion. Non-positive/non-finite intervals fall back to defaults.
- **Accessibility:** animated visible text is aria-hidden; a visually hidden
  plain-text copy exposes the complete sentence without repeatedly announcing
  decorative copy as a live status.
- **Screen contract:** normal-running Progress state; animated and serious-copy
  replacement examples demonstrated in Gallery.
- **Do / don't:** treat it as detached personality with zero job information;
  do not rotate on page completion or show it during quota/error states.

### `TabNav`

- **Props:** `activeTab`; `onTabChange`; optional `ariaLabel` (default “Main
  navigation”) and `className`. Tabs are fixed to `convert | history | keys |
  help`.
- **States:** active/current page, hover, and focus. The same component is a
  four-column compact bar below 64rem and a 13rem one-column side rail at or
  above 64rem. Its background is solid `--color-row`, not glass.
- **Accessibility / keys:** semantic `nav`; each React Aria button exposes
  `aria-current="page"` when active and activates with Enter/Space. It is page
  navigation, not an ARIA tablist, and it intentionally has no arrow-key tab
  behavior.
- **Screen contract:** AppShell navigation; dashboard sample in Gallery.
- **Do / don't:** keep all four labels and current-page state; do not add
  `role="tablist"` or persist Gallery as a fifth workflow tab.

### `FileRow`

- **Props:** required `name` and `size`; optional `answerSource = inside |
  key-file | none`, `answerSourceLabel`, `flagged`, `flagLabel`, `isDisabled`,
  `onAnswerSourceChange`, `onRemove`, `removeLabel`, `children`, and div
  attributes.
- **States:** standard, flagged, disabled; an undefined answer source displays
  “Use batch default”. Numeric byte sizes are sanitized and formatted through
  B/KB/MB/GB/TB; strings display unchanged. The answer source is controlled by
  the parent; changes report `undefined` for batch default.
- **Accessibility / keys:** the picker label includes the file name; the
  optional remove button has a generated accessible name and Enter/Space
  behavior. The nested Select supplies listbox keyboard behavior.
- **Screen contract:** Upload; standard, flagged, and disabled solid rows are
  demonstrated together inside one Gallery glass panel.
- **Do / don't:** use solid rows and keep the per-file override explicit; do
  not put a glass filter on each row or rely on the warning border alone.

### `Select`

- **Props:** generic `SelectOption<K>` entries contain `id`, `label`, optional
  `description` and `isDisabled`; component props require `label` and
  `options`, and accept controlled `value`, uncontrolled `defaultValue`,
  `onChange`, `description`, `errorMessage`, `className`, plus remaining React
  Aria Select props such as `isDisabled`, `isInvalid`, and `isRequired`.
- **States:** closed/open, focused, selected, invalid, disabled component, and
  disabled option. The popover is height-limited and scrollable.
- **Accessibility / keys:** React Aria provides linked label/help/error,
  single-selection listbox semantics, Arrow-key navigation, Enter/Space to
  open/select, Escape to close, and typeahead. Options use their label as
  `textValue`.
- **Screen contract:** Upload declarations and History retention; controlled,
  invalid, and disabled examples demonstrated in Gallery.
- **Do / don't:** provide stable IDs and concise labels; do not reproduce a
  select with a styled div/menu or hide important distinctions only in option
  descriptions.

### `Toggle`

- **Props:** required `label`; optional `description`, `errorMessage`, and
  `className`; passes remaining React Aria `SwitchField` props, including
  `isSelected`, `defaultSelected`, `onChange`, `isDisabled`, and `isInvalid`.
- **States:** on/off, focus, invalid, and disabled.
- **Accessibility / keys:** React Aria supplies labelled switch semantics and
  linked description/error; Space toggles the focused switch and the button
  primitive also supports normal keyboard activation. The actual
  `SwitchButton` receives the shared focus ring through
  `[data-focus-visible]`.
- **Screen contract:** per-run “keep original PDF” and History settings;
  on/off, invalid, and disabled examples demonstrated in Gallery.
- **Do / don't:** use for an immediate binary setting; do not use it for a
  one-shot action or make “on” inferable only from thumb position/color.

### `Badge`

- **Props:** required `children`; `tone = neutral | primary | success |
  warning | danger` (default `neutral`); standard span attributes.
- **States:** five visual tones; non-interactive.
- **Accessibility:** ordinary text with no live-region behavior. Dynamic
  announcements need a separate status region.
- **Screen contract:** dashboard and History, including the quiet “Not
  exported yet” label; every tone demonstrated in Gallery.
- **Do / don't:** use a badge for durable metadata; do not use one as a button
  or for urgent live feedback.

### `ResumeCard`

- **Props:** required `fileName` and `flagsLeft`; optional `continueLabel`
  (default “Continue”), `onContinue`, `isDisabled`, and article attributes.
- **States:** active/disabled; flag counts are floored, clamped at zero, and
  singularized. Non-finite counts become zero.
- **Accessibility / keys:** labelled article plus a native Continue button.
  The button name includes file name and remaining flags; Enter/Space works.
- **Screen contract:** Convert home when Review is minimized; active and
  disabled examples demonstrated in Gallery.
- **Do / don't:** preserve file and flag context in the action name; do not
  trap a user in Review or omit the minimize/resume path.

### `Dialog`

- **Props:** controlled `isOpen` and `onOpenChange`; required `title`; optional
  `description`, `children`, `actions`, `role = dialog | alertdialog`,
  `isDismissable` (default true), `dismissLabel` (default “Close dialog”),
  `className`, `overlayClassName`, and remaining ModalOverlay props. Body and
  actions may be nodes or `(close) => ReactNode` render functions.
- **States:** closed/open/entering/exiting and dismissable/non-dismissable. A
  labelled close button is always present.
- **Accessibility / keys:** React Aria provides modal semantics, title labelling,
  focus containment/restoration, Tab/Shift+Tab cycling, and Escape dismissal
  unless keyboard dismissal is disabled through the inherited overlay prop.
  Outside interaction dismisses only when `isDismissable` allows it.
- **Screen contract:** History confirmations; alert confirmation demonstrated
  in Gallery.
- **Do / don't:** use `alertdialog` only when an immediate decision is truly
  required and provide explicit actions; do not remove the close affordance
  or build a modal from an unlabelled overlay.

### `StorageMeter`

- **Props:** required `used` and `total`; optional `label` (default “Storage
  used”), `formatValue` (default byte formatter), and div attributes.
- **States:** empty/partial/full. Values are finite, non-negative, and clamped;
  total zero exposes a technical ARIA max of 1 with a value of 0 while visible
  and spoken text still says 0 of 0.
- **Accessibility:** `role="meter"` with min/max/now and complete used/total/
  percent value text. Decorative visible value and fill are aria-hidden.
- **Screen contract:** History Storage row; empty, typical, and full examples
  demonstrated in Gallery.
- **Do / don't:** give values in the same unit and use one formatter; do not
  use this determinate meter as a loading indicator.

### `ThemeSwitcher`

- **Props:** optional `label` (default “Appearance”) and `className`.
- **States:** System, Light, or Dark preference plus a separately reported
  resolved light/dark theme.
- **Accessibility / keys:** labelled `role="group"`; three toggle buttons use
  `aria-pressed`, Enter/Space activation, and the shared focus treatment. A
  polite live line announces “Showing light/dark theme”.
- **Screen contract:** Design Gallery and Help/settings; demonstrated at the
  top of Gallery.
- **Do / don't:** show both preference and resolved result; do not present a
  two-state sun/moon control that makes System invisible.

### `FileDropZone`

- **Props:** required `onFiles`; optional `allowsMultiple` (default true),
  `label` (default “Drop exam PDFs here”), `description` (default “PDF files
  only”), `isDisabled`, and `className`.
- **States:** idle, drop target, and disabled. Drop and picker paths accept
  MIME-typed PDFs or `.pdf` names; invalid/empty selections are ignored. When
  multiple files are disallowed, a drop is truncated to the first accepted
  file.
- **Accessibility / keys:** labelled React Aria DropZone plus a real hidden
  file input controlled by a visible “Choose files” button. Keyboard users
  reach that button and activate it with Enter/Space; the operating-system
  picker is restricted to PDF. The drop target itself receives the shared
  focus ring through React Aria's focus-visible state.
- **Screen contract:** Upload; active and disabled examples demonstrated in
  Gallery.
- **Do / don't:** keep a visible picker action alongside drag/drop; do not make
  dropping the only input method or silently accept non-PDF files.

### `ProviderOrderList`

- **Props:** required `items` and `onReorder`; optional `ariaLabel` (default
  “Provider failover order”), `className`, and `renderDetails`. Each item has
  `id`, `name`, optional `description`, and optional `StatusChip` status.
- **States:** ordered/first, working/status variants, focused-within,
  dragging, drop-target, and first/last disabled move control.
- **Accessibility / keys:** React Aria `GridList`/`GridListItem` and
  `useDragAndDrop` provide screen-reader, pointer, touch, and keyboard drag
  semantics. Every row also has explicit, labelled Move up/Move down buttons,
  so Enter/Space reordering does not depend on learning drag gestures. The
  drag handle and move buttons have item-specific accessible names.
  `keyboardNavigationBehavior="tab"` keeps embedded key fields and controls in
  normal Tab order and preserves native arrow-key caret editing.
- **Screen contract:** Keys provider failover order; interactive reorder and
  nested key fields demonstrated in Gallery.
- **Do / don't:** treat `onReorder` as the source of persistence and retain
  explicit move buttons; do not infer failover order from visual position
  without updating state.

### `AppShell`

- **Props:** required `children`; optional `header`, `navigation`, `className`,
  `isReviewTakeover` (default false), `mainAs = main | div` (default `main`),
  and `onMinimizeReview`.
- **States:** dashboard and focused Review takeover. Dashboard renders semantic
  header, aside navigation, and a main landmark by default; takeover hides
  navigation and, when a callback exists, adds a quiet “Minimize review” action
  before the content.
- **Accessibility:** entering takeover focuses Minimize; leaving it focuses the
  shell content rather than dropping focus to the document body. Use the
  default `main` for the real app. `mainAs="div"`
  exists only for an embedded shell demonstration already inside another main
  landmark, as in Gallery. The caller still owns route focus/heading behavior
  for ordinary navigation.
- **Screen contract:** shared app frame and Review takeover; both modes are
  demonstrated in Gallery. Below 64rem the navigation is fixed 16px from each
  side and 12px from the viewport bottom (plus safe-area insets), while the
  shell reserves 5.5rem plus the bottom safe area. Takeover removes that
  reserved space. From 64rem it becomes a sticky left rail with a 32px content
  gap and no reserved bottom space.
- **Do / don't:** always provide the minimize path during takeover; do not fork
  separate phone/desktop shells, show dashboard navigation over focused Review,
  or use `mainAs="div"` to remove the real app's main landmark.

## Theming and no-flash boot

[`src/design/theme.ts`](../src/design/theme.ts) exposes
`ThemePreference = system | light | dark`, `ResolvedTheme = light | dark`,
`setThemePreference`, `resolveTheme`, and `useTheme()`. The hook returns
`{ preference, resolvedTheme, setPreference }`.

- The storage key is `codox-theme-preference`. Explicit light/dark values are
  stored in `localStorage`; choosing System removes the key. Invalid values and
  storage failures resolve safely to System.
- A synchronous inline script in [`index.html`](../index.html) validates the
  stored value, resolves System through `prefers-color-scheme`, and sets
  `html[data-theme]`, the inline `color-scheme`, and the `theme-color` meta
  before the stylesheet/app loads. This is the no-wrong-theme-flash path.
- The module applies the resolved theme again on startup, updates the same
  three outputs on every change, listens to OS changes while in System mode,
  and listens to `storage` events so other tabs stay in sync.
- `useSyncExternalStore` provides consistent React subscriptions and a light
  server snapshot. If persistence is blocked, the chosen value still applies
  for the current page session.

Components consume semantic variables only; they never branch on theme in
render code. The only theme-specific selector is `[data-theme="dark"]` in the
token sheet.

## Rules screens must follow

These are composition constraints for the five Phase 3 screens, not a claim
that those screens have already been mocked up.

1. Import components only from `src/design/components`; consume tokens instead
   of adding screen-local palette, spacing, radius, focus, or motion systems.
2. Interactive controls target at least `--touch-target-min` (44px), use the
   shared focus ring/halo, remain keyboard operable, and keep visible text or
   an accessible name. Non-interactive chips/meters need not be 44px.
3. Use one glass container per visual section. Dense History, Review, upload,
   and provider rows stay solid. Never stack backdrop filters.
4. Compose desktop and phone layouts from the same components. App navigation
   is Convert / History / Keys / Help; Review takes over but always offers
   Minimize and a Convert-home `ResumeCard` path.
5. Progress bars advance on real completed work only. Normal work may show the
   detached `TypewriterLine`; quota and failures replace it with serious text.
   Quota language is calm—“paused — resumes when quota allows” / “Resting until
   quota returns”—and is never styled as an error.
6. Keep provider failures distinguishable in both words and treatment: wrong
   key uses danger, unreachable uses blue-neutral, quota uses amber, and
   working uses success. Never collapse them into “failed”.
7. Upload keeps one batch answer-source declaration with visible per-file
   overrides. A key-file declaration reveals the matching key-file input; the
   engine never guesses the answer form.
8. Review retains keyboard operation and uses solid scannable rows. Phone
   review is a flippable question/source view; desktop places them side by
   side. Flags do not block export.
9. Export is a prominent primary action. “Review N flags” may be primary in
   the flagged flow, but “Export as-is” remains available and clear. Unexported
   runs use the quiet “Not exported yet” badge; do not add eviction nags.
10. Respect reduced motion globally. Animate only purposeful transform and
    opacity with the shared durations/easings; semantic color changes are
    immediate. Do not add ambient decoration, fake progress, or event-driven
    sentence flashing.
11. The Design Gallery is a development-only review surface. `App.tsx` gates a
    lazy import and Gallery navigation button behind `import.meta.env.DEV`;
    local `galleryOpen` state can initialize from `?gallery=1`. It is not an
    `AppStep`, is not persisted to Dexie, and is absent from production builds'
    navigation.

## Provenance and licenses

- [`TRIVIADOX_PALETTE.md`](TRIVIADOX_PALETTE.md) supplies the locked base,
  primary, glass, warning, success, and typography direction. The semantic
  foreground pairs, four-pixel spacing/type scales, and implementation
  guardrails are Codox's implementation around that source.
- [`PHASE3_DESIGN_DECISIONS.md`](PHASE3_DESIGN_DECISIONS.md) supplies the
  owner-approved layout, navigation, progress, motion, theming, History,
  Upload, Export, and Keys behavior. The latest execution rules live in
  [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).
- The accessible primitives are `react-aria-components` 1.19.0, licensed
  Apache-2.0. Subpath imports are used for Button, Modal/Dialog, DropZone,
  FileTrigger, GridList, Select, Switch, TextField, and drag/drop.
- The self-hosted packages are `@fontsource/inter` 5.2.8 and
  `@fontsource/plus-jakarta-sans` 5.2.8, licensed OFL-1.1. Only the three Latin
  WOFF2 faces listed in Typography are bundled; no CDN is involved.
- Neon Scan is owner-approved project artwork stored at
  [`assets/codox-logo.svg`](assets/codox-logo.svg). The repository provides no
  separate open-asset license for the mark; do not treat it as a palette source
  or third-party reusable asset.
