# Codox UI behaviour guide

This is the plain-language reference for deciding whether a UI issue is a real bug, an intentional layout change, or a platform-specific limitation. It describes the application as implemented on 2026-07-14.

## The short version

Codox has **one interface**, not separate web, Windows, and Android designs. The same web build is shown in three containers.

| Where it runs | What it is | What should normally be the same |
| --- | --- | --- |
| Browser / installed PWA | Website, optionally installed from the browser | Screens, layout rules, data, theme, keyboard access, review flow |
| Windows | Same web build in a Tauri desktop window | Screens, layout rules, data, theme, keyboard access, review flow |
| Android | Same web build in a Capacitor Android app | Screens, layout rules, data, theme, review flow |

So a visual correction normally belongs in the shared UI and should improve all three. The app deliberately differs only when the device offers a different way to perform a real-world task, such as saving or sharing a file.

An iPhone and macOS currently use the browser/PWA route; they do not have a separate native Codox app.

## The key distinction: size is not operating system

The layout responds to the **available viewport width** (the usable content area), not to labels such as “Android”, “iPad”, or “web app”. A Windows window narrowed to phone width receives the compact layout. An Android tablet with a wide enough window receives the desktop layout. This is normal responsive-web behaviour and is preferable to guessing a device from its operating system.

When reporting a problem, record:

1. Window or viewport width × height, and portrait or landscape.
2. Touch, mouse/trackpad, keyboard, or a mixture.
3. Browser/PWA, Windows app, or Android app.
4. Any OS-controlled interface present: address bar, on-screen keyboard, notch, download prompt, or share sheet.

“It is broken on web” is usually not enough. For example, it may instead mean “it is broken in a 390 px Safari PWA viewport with the keyboard open.”

## Current size rules in Codox

`rem` is based on the user's text-size setting in the browser. At the usual default, `64rem` is 1024 CSS pixels and `48rem` is 768 CSS pixels. CSS pixels are *logical* pixels, not the tiny physical pixels advertised in phone specs.

| Available width | Current layout | Is this sensible? |
| --- | --- | --- |
| Below 768 px | Narrow-phone refinements: file areas stack vertically; storage meter is hidden; API/Help open as a bottom sheet; review actions become a compact grid. | Yes. This protects readable text and finger-sized actions. |
| 768 px to below 1024 px | Compact/tablet layout: header + fixed bottom navigation, one content column, no side rail. Storage is shown in the header. | A valid, deliberately conservative tablet layout. It prioritises room for the document/review task over cramming in sidebars. |
| 1024 px and above | Desktop layout: left sidebar (Convert, History, storage), centre work area, right utility rail (API, Help, theme). Review source and question appear side by side. | Yes for normal laptops and desktop windows. |
| Any very wide width | The outer frame expands, but the working column stops growing at about 1100 px. | Yes. Lines of text and forms should not become uncomfortably wide just because the monitor is wide. |
| Below 320 px | The document sets a 320 px minimum. Content may be clipped rather than endlessly compressed. | Acceptable as a minimum-support boundary, but do not claim polished support below 320 px. |

There is no separate landscape breakpoint. A phone rotated sideways follows its new available width. That is expected. If the keyboard, browser chrome, or split-screen changes usable height, the layout must still remain usable; it is not guaranteed to match a full-height screenshot.

### What changes at 1024 px

Below 1024 px, the sidebar becomes a simple top header, the right rail disappears, and Convert / History / API / Help move into the fixed bottom bar. The page reserves space beneath scrollable content so the bar does not cover buttons or text.

Above 1024 px, the frame has a 232 px sidebar, flexible centre column, and 96 px utility rail. During review, the evidence/source stays visible beside the question while the user works.

The threshold is a layout choice, not a claim that every 1024 px device is a “desktop”.

### What changes at 768 px

At and below 768 px, panels and upload areas become more vertical, compact review controls use full-width rows where needed, and API/Help become bottom-up drawers. This is more appropriate than a small centred pop-up on a phone.

At exactly 768 px the compact rules still apply; desktop rules start at 1024 px. That middle range is intentional.

## Screen behaviour users should expect

### Navigation

- Desktop: persistent left navigation selects Convert or History. API key settings and Help live in the right rail.
- Under 1024 px: the same destinations appear in a fixed bottom navigation bar. The active tab has a clear indicator.
- API and Help are overlays, not new pages. On narrow screens they are bottom drawers.
- The first-use API-key tip points at the right rail on desktop and bottom navigation on compact layouts.

Expected: changing width can move a control, but must not remove a destination or make an overlay impossible to close.

Bad: a desktop-only control has no compact equivalent, or the bottom navigation covers the last action on a page.

### Uploading PDFs

- The full drop zone is also a file-picker button. It works with mouse, touch, keyboard activation, and assistive technology.
- Drag-and-drop is a desktop convenience. It is not a requirement on a phone; phone users normally tap and choose a file through the OS picker.
- Only PDF files are accepted. Multiple exam PDFs may be selected where permitted; the optional answer-key slot takes one file.
- On narrow screens, upload zones stack and centre their contents rather than forcing a cramped horizontal row.

Bad: relying on dragging as the only upload path, requiring a tiny target, or placing the file picker behind another element.

### Review

- Desktop (1024 px+): the source crop/page and answer question are side by side. The source remains visible while the question column scrolls.
- Compact layout: one side is shown at a time to preserve readable evidence and large choices. A flip action moves between source and question.
- Answer choices have a minimum 44 px target and retain keyboard navigation. Keyboard shortcuts are helpful on desktop but must never be the only way to choose or confirm.

Bad: shrinking evidence or answer choices until they cannot be inspected or tapped; hiding the source without a clear reveal route; a sticky source that traps content behind browser chrome.

### Dialogs, drawers, and the on-screen keyboard

Dialogs trap keyboard focus and always provide a close button. On phone-width screens, API/Help drawers scroll internally and leave room for the top safe area and bottom home indicator. They use dynamic viewport height (`100dvh`), which follows visible height as mobile browser bars appear or disappear.

Expected: when the on-screen keyboard opens, less content is visible and the user may need to scroll the drawer.

Bad: the focused field or its Save/Continue action cannot be reached, the drawer runs under the notch/home indicator, or long-drawer scrolling leaks through to the page in a disorienting way.

### Theme, motion, and text size

- The initial theme follows the system light/dark preference unless the user has explicitly chosen light or dark in Codox. The explicit choice is stored locally on that installation.
- The selected theme also changes the browser/OS colour hint, reducing a bright flash at launch.
- If the system requests reduced motion, Codox effectively removes animations and smooth scrolling. This is an accessibility feature, not a visual bug.
- The UI uses `rem` units, so larger browser text settings enlarge much of the interface. Breakpoints in `rem` move too, which is generally desirable: enlarged text gets more room.

Bad: changing colours without preserving contrast/focus visibility, forcing animation despite reduced-motion preference, or locking text so users cannot zoom/read it.

## What changes by operating environment

| Behaviour | Browser / PWA | Windows desktop app | Android app |
| --- | --- | --- | --- |
| UI layout | Same shared responsive rules | Same shared responsive rules | Same shared responsive rules |
| PDF choice | Browser picker; drag/drop where supported | Desktop picker and drag/drop | Android document picker; tapping is normal |
| Preferred export | Phone-like coarse-pointer browsers try the OS share sheet; otherwise Save As or download | Save As picker where available; otherwise browser-style download fallback | Writes zip to temporary app storage, then opens Android's native share sheet |
| Updates | Service worker handles web/PWA updates | Checks GitHub Releases at start, installs, then relaunches | Checks GitHub Releases at launch; a banner downloads the new APK and opens the system installer (user taps through — not silent) |
| Data storage | Browser/PWA local storage and IndexedDB | WebView local storage and IndexedDB | Android WebView local storage and IndexedDB |

The native Android export route is selected because the app is inside a Capacitor container. Browser export chooses sharing on a coarse-pointer device only when the browser says it can share a file. Otherwise it falls back to the best save/download route.

This is **capability-based behaviour** and is good. It would be bad to assume every Android device, browser, or touchscreen has identical sharing facilities.

### Platform realities

- **iPhone/iPad:** Codox is used as Safari web/PWA. File sharing should use the system share sheet when supported; users choose “Save to Files” or another destination. iOS may evict PWA storage after disuse, so exporting completed work promptly is essential.
- **Android:** The APK provides the native share sheet. Browser Codox on Android behaves like the browser/PWA column. The app must never assume a user has a mouse or can drag files.
- **Windows:** The Tauri shell has normal resizing, mouse, keyboard, and a native updater. It still renders the same web UI, so a narrow window correctly becomes compact.
- **macOS/Linux:** No native Codox shell is shipped; browser/PWA rules apply. Do not introduce a “desktop app” assumption unless a shell is actually shipped.
- **Web browsers:** Save/download details depend on browser support and settings. A download fallback is not necessarily failed export, but the message must say where the file went.

## Safe areas and browser chrome

Modern phones may have a notch, rounded corners, a home indicator, or browser controls that slide in and out. Codox asks browsers to use the full screen and adds safe-area padding around the compact header, bottom bar, coachmark, and phone drawer.

Expected: bottom navigation sits above the home indicator and content has extra bottom room. A small visible-height change while scrolling Safari or Chrome is normal.

Bad: important actions lie beneath a notch, home indicator, bottom bar, or transient browser address bar.

## Interaction and accessibility baseline

These are industry-standard expectations for a productivity form application:

- Main controls have a minimum target of 2.75rem (44 px at default text size), the usual recommended minimum for touch.
- Keyboard focus must be visible. Codox supplies a strong focus ring instead of relying on the browser's inconsistent default.
- Hover is decorative feedback, never the only way to discover or perform an action. Touch devices may have no real hover state.
- Colour is paired with text, icons, borders, or state so it is not the only signal.
- Real buttons, inputs, dialogs, and navigation are used rather than clickable `div`s. A dialog keeps focus inside until closed.
- Text should wrap or break long filenames/messages instead of producing horizontal page scroll. The app hides accidental horizontal overflow; that must not conceal meaningful content.
- Zoom and user text-size changes must not cause controls to overlap, vanish, or become untappable.

## Quick “is this bad?” guide

| Observation | Usually expected | Needs a fix or decision |
| --- | --- | --- |
| Sidebar changes to bottom tabs after resizing | Yes, below 1024 px | A destination is missing or obscured |
| Dragging a file does nothing on a phone | Fine if tapping opens the picker | Tapping or keyboard activation cannot choose a PDF |
| Phone shows one review side at a time | Yes | No obvious flip/back route, or an answer cannot be confirmed |
| Browser address bar changes page height | Yes | Content or fixed control becomes unreachable |
| Export opens a share sheet on Android/phone browser | Yes | Success is recorded after cancellation, or no fallback exists after a real error |
| Export opens Save As/download on desktop browser/Windows | Yes | User is told it was saved after cancellation/failure |
| Hover colour is absent on touch | Yes | Action has no tap, focus, or accessible label |
| Dark mode differs from OS title/status area | Worth checking | Text/focus/status loses contrast or meaning |
| Desktop window at 800 px looks compact | Yes | Compact action is too small or impossible to use |
| Native wrapper has different file/export UI | Often correct | Core task, data, or semantics diverge without platform need |

## Before asking for a UI change

Capture this smallest useful test description:

```text
Screen: Convert / History / Review / API / Help
Runtime: browser/PWA, Windows app, or Android app
Viewport: width × height (and portrait/landscape)
Input: touch, mouse, keyboard, or mixed
Theme/text size: light/dark; default/larger
Expected: what the user should be able to see or do
Actual: what happens, including whether it is covered, clipped, or unreachable
```

For a layout change, check at least:

1. 320 × 568: small phone.
2. 390 × 844: current phone, including keyboard open in a drawer.
3. 768 × 1024: tablet / compact boundary.
4. 1024 × 768: desktop boundary and short-height window.
5. 1440 × 900: ordinary laptop/desktop.
6. One touch environment and one mouse + keyboard environment.
7. Light and dark, plus reduced motion if the change animates.

The goal is not pixel-perfect sameness across devices. The standard is that every supported user can understand the task, reach every essential control, read the content, and safely export their work.

## Where these rules live

- Shared layout, breakpoints, safe areas, review behaviour, and component styles: `src/design/components/components.css`.
- Global typography, minimum width, focus ring, and reduced-motion support: `src/index.css` and `src/design/tokens.css`.
- Responsive navigation and dialogs: `src/App.tsx` and `src/design/components/Dialog.tsx`.
- File picking/drop zone: `src/design/components/FileDropZone.tsx`.
- Theme: `src/design/theme.ts` and `index.html`.
- Export routing: `src/export/exporter.ts`.
- Windows shell and updater: `src-tauri/tauri.conf.json` and `src/updater.ts`.
- Android wrapper: `capacitor.config.ts` and `android/`.

Fix a problem in the shared layer unless it is a genuine platform capability difference. That prevents repairing a browser-only symptom while leaving the same underlying issue in the Windows or Android shell.

