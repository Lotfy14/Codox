# Phase 5 — PDF pipeline: AI handoff plan

_Written 2026-07-11. Audience: an AI coding agent (or developer) with full
access to this repository. Execute the steps in order; each ends with a
"Done when" gate. Scope is Phase 5 of [BUILD_PLAN.md](BUILD_PLAN.md): the
all-client-side, memory-disciplined PDF pipeline — render pages one at a
time with pdfium, extract the pdf.js text layer, compress to JPEG, crop
figures, and wire the real Upload/Convert screen into job state. The phase
gate: **a real 25-page scan renders page-by-page on a mid-range Android
phone and the oldest available iPhone with no crash and flat memory
page-to-page.**_

---

## 0. Read these first (in order, before writing any code)

1. `CLAUDE.md` — the hard rules (COST-ZERO, NEVER-GUESS, key on-device),
   mobile memory discipline, one-bad-page-never-crashes, search-before-build.
   **Binding.**
2. `Docs/CODOX_MIGRATION.md` §1.8 ("Bounding boxes and crops") and the
   parameters table (Render DPI = 200) — the pinned coordinate rule this
   whole phase serves. Also §"Render pages" (step 1 of the engine flow).
3. `Docs/BUILD_PLAN.md` Phase 5 — the checklist this plan expands.
4. `design-system/DESIGN_SYSTEM.md` + `design-system/ERROR_LANGUAGE.md` —
   component contract and the only allowed user-visible words.
   `src/copy/messages.ts` is the canonical strings module; **never invent
   new tutor-visible strings** — if one is missing, stop and flag it to the
   owner so ERROR_LANGUAGE.md gets updated first.
5. `src/mockups/ConvertMock.tsx` — the visual reference for the Convert
   screen's `home` and `files` stages (this phase builds those two stages
   for real; `running`/`done` are Phase 6).
6. Current code to build on: `src/state/db.ts` (Dexie versioning pattern),
   `src/state/useCurrentJob.ts`, `src/design/components/` (FileDropZone,
   FileRow, Select, Toggle, GlassPanel, Button all exist and are the ones
   to use), `src/App.tsx` (tab shell; Convert currently renders
   `ConvertPlaceholder`).
7. Memory/verification note: headless-browser verification on this machine
   uses `playwright-core` (already a devDependency) with
   `chromium.launch({ channel: 'msedge', headless: true })` — no browser
   download. Drive scripts must live **inside the repo** (e.g. `scripts/`)
   or node cannot resolve `playwright-core`. Vite dev server: port 5173.

## 1. Locked decisions — do not re-litigate

- **@hyzyla/pdfium renders pixels; pdf.js reads the text layer. Nothing
  else opens PDFs.** Both are already installed (see §2). No MuPDF
  (AGPL), no pdf-lib, no second renderer.
- **Gemini reads the images.** The PDF libraries never interpret exam
  content — pdfium turns pages into pictures, Gemini (Phase 6) does all
  reading. pdf.js text is a supplementary *hint* for born-digital PDFs,
  passed alongside the image, never a replacement for it.
- **Fixed render scale: 200 DPI** (`scale = 200/72 ≈ 2.778`). Every page is
  rendered once at this scale; planner boxes, crops, and review all use
  those exact images. **Never re-render at a different scale between
  planning and cropping** (CODOX_MIGRATION §1.8). If Review later wants a
  sharper zoom, that is a display-only re-render and must never feed the
  engine or the bundle.
- **Page-at-a-time discipline is law:** render → compress to JPEG → hand
  off → release the raw bitmap and destroy/zero the canvas before touching
  the next page. Nothing full-resolution is retained; the compressed JPEG
  is the only per-page pixel artifact kept.
- **WASM re-init safety net:** destroy the pdfium document + library and
  re-init every ~8 pages (constant, configurable) to cap any native-heap
  leak. Cheap insurance mandated by BUILD_PLAN.
- **One bad page never crashes a job:** a page that fails to render or
  encode is recorded as a page failure and the loop continues.
- **Encrypted/broken PDFs degrade politely** with the canonical strings:
  `uploadMessages.encryptedPdf(name)` for password-protected,
  `uploadMessages.notPdf(name)` for not-a-PDF/corrupted. Detection is by
  pdfium's load-error messages (see §2).
- **One codebase, no platform forks.** The pipeline is plain web API
  (canvas, createImageBitmap, Blob) and runs identically in browser, Tauri,
  and Capacitor.
- **Convert's Start button stays honestly disabled** in Phase 5 (label the
  reason: converting arrives in Phase 6). Phase 5 delivers upload +
  declaration + persistence, not the run.

## 2. Verified facts — already researched, do not re-derive

Both packages were installed and their installed code inspected on
2026-07-11. Versions in `package.json`: **@hyzyla/pdfium 2.1.13** (MIT),
**pdfjs-dist 6.1.200** (Apache-2.0). COST-ZERO compliant.

### @hyzyla/pdfium (browser build)

```ts
import { PDFiumLibrary } from '@hyzyla/pdfium'          // browser condition resolves automatically
import pdfiumWasmUrl from '@hyzyla/pdfium/pdfium.wasm?url' // Vite serves the ~4 MB wasm

const library = await PDFiumLibrary.init({ wasmUrl: pdfiumWasmUrl })
const document = await library.loadDocument(bytes /* Uint8Array */)
document.getPageCount()                                  // number
const page = document.getPage(pageIndex)                 // zero-based
const r = await page.render({ scale: 200 / 72, render: 'bitmap' })
// r: { width, height, originalWidth, originalHeight, data: Uint8Array }
// r.data is already RGBA (the library converts pdfium's BGRA/BGR/Gray
// to RGBA in JS and frees the WASM-heap buffer itself) — it can go
// straight into an ImageData for a canvas.
document.destroy()                                       // required
library.destroy()                                        // required
```

- `loadDocument` **copies** the bytes into the WASM heap, so the same
  `Uint8Array` can be reloaded after a re-init.
- Load failures throw plain `Error`s with fixed messages; the two that
  matter: `"Password required or incorrect password"` (→ encrypted) and
  `"File not in PDF format or corrupted"` (→ not a PDF).
- `PDFiumPage` has no destroy method; per-page native state is why the
  every-~8-pages library re-init exists.
- The page also exposes `getText()`, but the text layer stays with pdf.js
  per the decided stack — do not switch.

### pdfjs-dist

```ts
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
```

- Pass `getDocument({ data: bytes.slice() })` — pdf.js transfers the
  buffer to its worker, so hand it a **copy** or the caller's bytes become
  unusable for pdfium.
- Text per page: `page.getTextContent()` → `items`; keep items with a
  `str` property; append `'\n'` when `item.hasEOL`, else a space. Scanned
  pages simply yield an empty string — that is normal, not an error.
- Wrap the whole extraction in try/catch returning `[]` — a PDF that
  pdf.js cannot parse must not kill the render loop (pdfium may still
  render it).

### Vite/PWA

- `?url` imports are typed via the existing `vite-env.d.ts`
  (`vite/client`), no extra declarations needed.
- vite-plugin-pwa/workbox default precache limit is 2 MB; `pdfium.wasm` is
  ~4 MB. In `vite.config.ts` add to the `VitePWA({ ... })` options:

  ```ts
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,woff2}'],
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  },
  ```

  Otherwise the offline PWA cannot render PDFs.

## 3. Step-by-step build

### Step 1 — `src/pdf/` module (the pipeline core)

`src/pdf/types.ts` **already exists** (written 2026-07-11): `PageBitmap`,
`CropBox`, `ProcessedPage`, `PageFailure`. Build the rest around it:

1. **`src/pdf/pdfium.ts`** — rendering with the discipline baked in:
   - Constants: `RENDER_DPI = 200`, `REINIT_EVERY_PAGES = 8`,
     `scaleForDpi(dpi) = dpi / 72`.
   - `EncryptedPdfError` / `NotAPdfError` classes; map pdfium's load-error
     messages to them.
   - `readPdfInfo(bytes): Promise<{ pageCount: number }>` — open, count,
     destroy. Used by the Upload screen on drop.
   - `forEachRenderedPage(bytes, onPage, options?): Promise<{ pageCount,
     failures: PageFailure[] }>` — the loop: load library+document once;
     for each page (checking `options.signal?.throwIfAborted()`), render at
     the fixed scale and `await onPage(bitmap, pageCount)`; every
     `reinitEvery` pages destroy document+library and re-init/reload; a
     per-page render failure goes into `failures` and the loop continues;
     `finally` destroys document+library.
   - `renderSinglePage(bytes, pageIndex, dpi?)` — for the spike surface
     and later Review display zoom.
2. **`src/pdf/images.ts`** — canvas helpers (prefer `OffscreenCanvas`,
   fall back to `document.createElement('canvas')`; always zero
   width/height in `finally` to release the backing store):
   - `PAGE_JPEG_QUALITY = 0.8`, `CROP_JPEG_QUALITY = 0.85` (tune only with
     measurements).
   - `bitmapToJpeg(bitmap, quality?)` — `ImageData` view over
     `bitmap.data` (no copy) → `putImageData` → JPEG Blob
     (`convertToBlob` / `toBlob`).
   - `clampCropBox(box, pageWidth, pageHeight): CropBox | null` — pure,
     integer-clamped, `null` when the box has no area on the page.
     **The cropper clamps but never reinterprets boxes** — a wrong planner
     box produces a wrong crop, which the audit gate catches (pinned).
   - `cropJpeg(pageJpeg, box, quality?)` —
     `createImageBitmap(blob, sx, sy, sw, sh)` → small canvas → JPEG;
     `bitmap.close()` in `finally`.
3. **`src/pdf/textLayer.ts`** — `extractTextLayers(bytes): Promise<string[]>`
   per §2; one string per page, `''` when absent; `loadingTask.destroy()`
   in `finally`.
4. **`src/pdf/pipeline.ts`** — `processPdf(bytes, onPage, options?)`:
   extract text layers first (cheap, whole-doc), then
   `forEachRenderedPage`; per page `bitmapToJpeg` → build `ProcessedPage`
   (with `text: texts[pageIndex] ?? ''`) → `await onPage(page)` → drop all
   references to the raw bitmap. JPEG-encode failures join `failures`.
   Returns `{ pageCount, failures }`. This is the function Phase 6's
   engine executor will call.
5. **`src/pdf/index.ts`** — re-export the public surface.

**Done when:** `tsc -b` passes and the module renders a multi-page PDF in
the spike surface (Step 4) with memory released page-to-page.

### Step 2 — Vite/PWA config

Apply the `workbox` block from §2. **Done when:** `npm run build` output
lists `pdfium.wasm` in the precache manifest (build log) with no
size-limit warning.

### Step 3 — Job state: files + declaration (Dexie v4)

1. `src/state/types.ts`:
   - `export type AnswerSource = 'inside' | 'key-file' | 'none'` (matches
     `FileAnswerSource` in `src/design/components/FileRow.tsx`).
   - `JobState` gains optional `batchAnswerSource?: AnswerSource` (UI
     default `'inside'`) and `keepOriginal?: boolean` (UI default `true`).
   - New `StoredPdf`: `{ id: string; jobId: string; kind: 'exam' |
     'answer-key'; name: string; size: number; pageCount: number;
     addedAt: number; answerSource?: AnswerSource; blob: Blob }`.
     `answerSource` is the per-file override; `undefined` = batch default.
2. `src/state/db.ts`: **additive** `this.version(4).stores({ jobs: 'id',
   meta: 'key', credentials: 'id', files: 'id, jobId' })` — follow the
   existing versioning comment style; never touch older versions.
3. `src/state/files.ts`: `addStoredPdf` (store the `File` object directly
   as the blob — structured-cloneable), `removeStoredPdf`, `clearJobPdfs`,
   `setPdfAnswerSource`, `putAnswerKeyPdf` (adding a `kind: 'answer-key'`
   file **replaces** any existing answer key for that job — one per job,
   transactional), and a `useJobPdfs(jobId)` live-query hook sorted by
   `addedAt`.
4. `src/state/useCurrentJob.ts`: expose an `updateJob(patch)` (Dexie
   `update`) for the declaration/toggle fields; export `CURRENT_JOB_ID`.

**Done when:** unit tests (fake-indexeddb, same pattern as
`credentials.test.ts`) cover add/remove/clear, per-file override update,
and answer-key replacement (count stays 1).

### Step 4 — PDF spike surface (the stress-test instrument)

`src/screens/PdfSpike.tsx`, reachable via **`?pdfspike=1` in every build,
not just dev** — the phone stress test runs on the shipped `.apk`/PWA,
which are production builds. (Precedent: `Phase2SpikeChecks` is dev-only,
but its device checks were one-off; the memory stress test must be
repeatable on devices. Keep the screen clearly labelled as a diagnostic
surface.)

- Plain `<input type="file" accept="application/pdf">` → run `processPdf`.
- Live per-page stats table: page n/pageCount, render+encode ms, JPEG KB,
  text-layer chars; running total time; `performance.memory?.usedJSHeapSize`
  before/after each page where available (Chromium-only, fine).
- Show only the **current** page as a thumbnail (`URL.createObjectURL`,
  revoke the previous one) — the spike itself must obey the memory
  discipline it measures.
- Show `failures` count and messages; abort button wired to an
  `AbortController`.
- Wire into `src/App.tsx` beside the existing query-param views (but not
  gated by `import.meta.env.DEV`).

**Done when:** dropping any local PDF renders all pages sequentially with
visible per-page stats and a flat heap trend.

### Step 5 — Real Convert screen (home + files stages)

Replace `ConvertPlaceholder` with `src/screens/Convert.tsx`, following
`ConvertMock.tsx` for structure and `src/screens/app.css` conventions for
styling (port the needed `mock-*` styles from `src/mockups/mockups.css` as
`convert-*` classes in `app.css`; do not import mockup CSS).

- **Stage is derived, not stored:** no exam files → home stage (big
  `FileDropZone`); files present → files stage (list + "Before you start"
  panel). No sample-files button (mockup-only).
- **On files dropped/picked** (both zones use the existing
  `FileDropZone`): for each file — `readPdfInfo(new Uint8Array(await
  file.arrayBuffer()))`; on success `addStoredPdf({ kind: 'exam', …,
  pageCount, blob: file })`; on `EncryptedPdfError` →
  `uploadMessages.encryptedPdf(file.name)` note; on any other open failure
  → `uploadMessages.notPdf(file.name)` note. Notes render as the mockup's
  inline note (danger tone), one per failed file; a new drop replaces old
  notes. A failed file is never stored. Show a busy state while counting
  pages.
- **Files list:** `FileRow` per stored exam PDF (name, size, per-file
  answer-source override → `setPdfAnswerSource`, remove →
  `removeStoredPdf`), "N PDFs ready" header with a Clear button
  (`clearJobPdfs`), and a smaller "drop more" `FileDropZone` below.
- **Before you start panel:** `Select` with
  `uploadMessages.declarationQuestion` / `declarationHelp` and the three
  options (Inside the PDFs / separate key file / no answers) →
  `updateJob({ batchAnswerSource })`. Conditional answer-key slot exactly
  per the mockup's `needsKeyFile` logic:

  ```ts
  needsAnswerKeyFile(batchSource, exams) =
    (batchSource === 'key-file' && exams.some(f => f.answerSource === undefined))
    || exams.some(f => f.answerSource === 'key-file')
  ```

  When needed and no key file stored: `uploadMessages.needsKeyFile` info
  note + single-file `FileDropZone` → `putAnswerKeyPdf`. When stored:
  "✓ name added" line with a remove control. `Toggle` "Keep original PDF"
  → `updateJob({ keepOriginal })`.
- **Start row:** page total + flat ~5 s/page estimate (as in the mockup),
  and a **disabled** "Start converting" button with a quiet, honest note
  that converting arrives in Phase 6 and everything entered here is saved
  on this device. Exception: keep the mockup's rule that Start is also
  blocked while a required answer key is missing.
- Everything keyboard-reachable (the components already are); the
  declaration `Select` and per-row overrides must be operable without a
  mouse.
- Extract the pure helpers (`needsAnswerKeyFile`, the minutes estimate)
  into `src/screens/convert-logic.ts` for unit testing.

**Done when:** drop PDFs → reload the app → files, per-file overrides,
declaration, and toggle are all still there (IndexedDB), and the notes
show for an encrypted and a non-PDF file.

### Step 6 — Tests + typecheck + lint

- `npm run test`: new units — `clampCropBox` (pure), `convert-logic`
  (needsAnswerKeyFile matrix incl. the empty-files case), `files.test.ts`
  (Step 3). Do **not** try to run pdfium/pdf.js under happy-dom — WASM +
  workers belong to the browser drive (Step 7).
- `npm run build` (includes `tsc -b`) and `npm run lint` clean.

### Step 7 — Headless-browser verification (the real proof)

Write `scripts/drive-phase5.mjs` (in-repo, per §0.7), pattern-matched on
the Phase-4 drive scripts (`git show ed39e26` lists them):

1. Start `npm run dev` (port 5173).
2. Launch Edge headless; **seed first-run** so the walkthrough doesn't
   block Convert: open the app origin, `page.evaluate` a Dexie/IndexedDB
   write of meta key `firstRunCompletedAt`, then reload. (Or drive the
   real walkthrough once — either is fine; a fresh context has empty
   IndexedDB.)
3. Generate a small 3-page PDF **in the script** (hand-rolled minimal PDF
   bytes with a line of text per page — no new dependency) and save it to
   the scratchpad or `node_modules/.cache`.
4. Drive `/?pdfspike=1`: set the file input, await completion, assert
   pageCount = 3, every page has JPEG KB > 0 and text-layer chars > 0,
   failures = 0. Screenshot.
5. Drive Convert: drop the same PDF via `setInputFiles` on the
   FileDropZone's hidden input, assert the file row appears with "3
   pages"-worth of estimate, change the declaration to "separate key
   file", assert the key-file slot appears, reload the page, assert
   everything persisted. Screenshot.
6. Also assert the encrypted/not-PDF notes: feed a text file renamed
   `.pdf` (pdfium: not-PDF note) — FileDropZone filters by name/type, so
   a fake `.pdf` goes through to pdfium and must produce the note, not a
   stored row.

**Done when:** the script exits green end-to-end and screenshots look
like the mockup's home/files stages.

### Step 8 — Device stress test (owner/human step — the phase gate)

1. `npm run build`, rebuild both shells per `Docs/RELEASING.md`, sideload
   the `.apk`; open the PWA on the iPhone.
2. On each device open `?pdfspike=1`, load a **real 25-page scanned exam
   PDF**, run it, and watch: no crash, per-page times roughly constant,
   heap flat page-to-page (Android: also eyeball via
   `chrome://inspect` if convenient).
3. Record the result (device models, total time, peak heap if visible) in
   BUILD_PLAN Phase 5 as the evidence note.

**Done when:** both devices finish the 25-page scan without crashing and
memory stays flat — that closes Phase 5.

### Step 9 — Bookkeeping

- Tick the Phase-5 checkboxes in `Docs/BUILD_PLAN.md` with dated evidence
  notes (follow the Phase-2/4 style); link this plan from the Phase-5
  heading.
- Commit in sensible slices (module, state, screen, verification), message
  style per git history.

## 4. Already done (2026-07-11, before this handoff)

- `npm install @hyzyla/pdfium pdfjs-dist` — in `package.json` at the
  versions in §2; both APIs inspected against the installed code.
- `src/pdf/types.ts` written (PageBitmap / CropBox / ProcessedPage /
  PageFailure with the §1.8 coordinate rule documented).
- BUILD_PLAN Phases 0–4 fully closed (owner confirmed the Phase-4 manual
  gate and the browser-PWA Gemini re-confirm; relay permanently dropped).
- Nothing else — no other Phase-5 code exists yet; Steps 1–9 above are
  all open.

## 5. Traps (learned the hard way elsewhere — avoid)

- Don't hold more than one page's raw RGBA at a time, ever — a 200-DPI A4
  page is ~35 MB raw; two or three in flight blows the ~100 MB phone
  budget on their own. The JPEG (a few hundred KB) is what lives on.
- Don't `bytes.slice()` for pdfium (it copies internally) but **do** for
  pdf.js (it transfers).
- Don't gate the spike surface behind `import.meta.env.DEV` — the phone
  gate runs on production builds.
- Don't add user-facing strings outside `src/copy/messages.ts`; don't
  reuse the historical multi-provider copy in `src/mockups/copy.ts`.
- Don't wire Start to anything — Phase 6 owns the run.
- `FileDropZone` already filters non-PDFs by extension/MIME with no
  feedback; the pdfium open check is what produces the visible note for
  disguised non-PDFs. Keep both layers.
