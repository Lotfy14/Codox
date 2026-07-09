# Codox Tech Stack — Research Summary & Recommendation

_Written 2026-07-09. Produced by six parallel web-research agents (Claude Sonnet),
orchestrated against the constraints in [CODOX_CONTEXT.md](CODOX_CONTEXT.md).
Decision inputs from the owner: AI agents write most of the code; Windows,
Android, iPhone, and web are ALL must-have at launch; one codebase with
identical behavior everywhere (no per-platform OS-OCR path); Android must ship
as a real `.apk` file, not just an installable link._

---

## The recommended stack (one table)

| Layer | Choice | vs. prior v2 PRD plan | Confidence |
|---|---|---|---|
| Language + framework | **TypeScript + React 19 + Vite** | same | Medium-High |
| Web + iPhone + macOS | **PWA** (vite-plugin-pwa) on Cloudflare Pages | same | High |
| Windows shell | **Tauri 2** → NSIS `.exe` | same | High |
| Android shell | **Capacitor** → `.apk` | **changed** (was Tauri 2) | Medium-High |
| PDF render + crop | **@hyzyla/pdfium** (pdfium-wasm, MIT) | same class, now a named package | Medium-High |
| PDF text layer | **pdf.js `getTextContent()`** (alongside pdfium) | new hybrid detail | Medium |
| Zip export | **fflate** (streaming) | same | High |
| Figure cropping | `createImageBitmap(sx,sy,sw,sh)` → small canvas → blob | new detail | Medium-High |
| Provider chain | **Groq → Gemini (direct!) → OpenRouter `:free` → GitHub Models → Mistral** | changed (Gemini may not need the relay; two new providers) | High on CORS, Medium on quota numbers |
| Relay | **Probably delete it** (pending one browser smoke test of Gemini) | changed | Medium until smoke-tested |

**In one sentence:** the old plan survives almost intact — the only structural
changes are *Capacitor instead of Tauri on Android*, and *Gemini may now work
without the relay*, which would make Codox 100% serverless.

---

## The "why," explained like you're five

### Why React? Because the robot has read the most React books.
You told us robots (AI agents) will write almost all the code. Robots write
best in the language they've seen the most. A real benchmark (Web-Bench, 2025)
tested this: the robot got React tasks right about **65%** of the time, but
Svelte and Vue only **25–30%**. Svelte even changed its own rules recently
(runes), so robots keep writing the *old* Svelte by mistake. React also has
the biggest box of ready-made, keyboard-friendly building blocks (React Aria,
Radix) — and the review screen, where a tutor fixes flagged answers with a
keyboard, is the part we can least afford to get subtly wrong.

*(Svelte makes smaller apps — but the PDF machinery weighs far more than the
framework, so that saving doesn't matter here.)*

### Why is the app a website wearing costumes? Because Apple said so.
iPhones simply will not accept an app file for free — the only free door is
"Add to Home Screen" in Safari. So the heart of Codox **must** be a web app.
Windows and Android then get the *same* web app dressed in a thin costume:
a `.exe` costume and a `.apk` costume. One brain, three outfits, zero forks.

### Why Tauri on Windows? Smallest costume, no downsides.
Tauri makes a tiny installer (a few MB, vs. Electron's 80–200 MB) because it
borrows the WebView browser engine Windows already has (preinstalled on
essentially every machine by 2026). Every unsigned installer gets the same
scary SmartScreen prompt no matter the tool — even paying for certificates no
longer skips it — so Tauri loses nothing there. **New gotcha found:** school
IT departments can ban "Run anyway" completely, so the landing page must tell
tutors on managed laptops to use the browser-install (PWA) path instead.

### Why Capacitor on Android, not Tauri? Because we checked, like the old plan told us to.
The old plan itself said: "test Tauri on Android before trusting it, and if
it wobbles, use Capacitor" (BLIND-SPOTS #11). The research did the checking:
in mid-2026 Tauri's Android side still has signing/Gradle build friction, no
official share-sheet plugin, and needs third-party plugins for real file work.
Capacitor has official, mature file/share plugins and years of production
`.apk`s behind it. The web app inside is identical either way — only the
costume changes. *(The zero-work alternative, a TWA/PWABuilder apk, has a
trap: opened offline on first launch, it shows a browser address bar —
wrong first impression.)*

### Why Groq first in the provider chain? It's fast AND it promises not to peek.
Groq is quick, allows browser calls, and — verified in its own docs — **does
not train on your data**. That's the kindest privacy story for a consent
notice. Gemini free tier explicitly *does* learn from what you send
("used to improve our products: Yes"), and Mistral's free tier trains **by
default** unless you opt out — both stay in the chain but the notice must say
this plainly (PRIVACY-TOLD).

### The big surprise: Gemini's door might now be open.
CODOX_CONTEXT.md measured Gemini as CORS-blocked on **2026-07-08**. Our agent
ran live header tests on **2026-07-09** and got proper
`Access-Control-Allow-Origin` headers on all three Gemini endpoints — from
curl, which reads raw headers. One day apart, opposite answers. Either Google
just changed it, or the two tests differed (browser vs. curl, different
request headers). **Do not ship on this until a 10-minute smoke test from a
real browser page confirms it.** If it holds: the Cloudflare Worker relay —
the last server component — gets deleted, and Codox becomes a fully
serverless, static-hosted app. (There's also a reported wrinkle: Gemini may
drop the CORS header on some 503 error responses, so error handling must not
misread that as "bad key" — exactly the BLIND-SPOTS #9 lesson.)

### Why pdfium for pixels but pdf.js for words? Each is best at one job.
PDFium (Chrome's own PDF engine, via `@hyzyla/pdfium`, MIT, actively
maintained) draws scanned pages more faithfully than pdf.js — and it can
rasterize *just a rectangle* of a page at high DPI, which is perfect for
cropping clinical figures without ever holding a giant full-page image in
memory. pdf.js is the veteran at reading the invisible text layer (it powers
Firefox). Use both, each for its specialty. **Avoid MuPDF.js** (AGPL-or-pay)
and Nutrient/Apryse (no free tier — COST-ZERO trap).

### Why is "export early" now even more of a law? Because phones are meaner than we thought.
Confirmed for 2026: iOS can still evict a PWA's storage after ~7 days of
disuse, `persist()` is a polite request Apple may ignore, and — new finding —
the plain download link **silently fails** inside an installed iOS PWA. The
one reliable iOS export path is the share sheet (`navigator.share({files})` →
"Save to Files"). Also new and sobering: an iPhone-SE-class browser tab dies
at roughly **~100 MB** of working memory, with **no catchable error** — it
just crashes. So: render one page at a time, destroy each canvas immediately,
export the bundle the moment review finishes, and never let the app be the
only holder of a tutor's work.

---

## What changed vs. CODOX_CONTEXT.md (deltas to record)

1. **Gemini CORS**: doc said blocked (2026-07-08); live headers say open
   (2026-07-09). Needs a browser smoke test; if confirmed, update §7 and drop
   the relay (open decision "relay vs drop" resolves to **drop**).
2. **NVIDIA NIM CORS**: doc said unverified → now **verified blocked** (and
   SambaNova too). NIM only participates via a relay — or, simpler, via its
   models served through OpenRouter `:free`, which is CORS-open.
3. **Android shell**: Tauri → **Capacitor** (the doc's own named fallback).
   Tauri stays for Windows only, where it's mature.
4. **Provider chain order**: was Groq → OpenRouter → NVIDIA → Gemini(relay);
   now **Groq → Gemini(direct) → OpenRouter → GitHub Models → Mistral**, with
   NVIDIA/SambaNova relay-only if kept at all.
5. **New memory number**: design target ≈ **100 MB working set**
   (iPhone-SE-class), ~384 MB aggregate canvas budget on iOS — tighter than
   the doc's "825 MB would kill the tab" framing implied.
6. **New consent-notice facts**: Groq doesn't train (verified); Gemini free
   tier does (verified); Mistral free trains by default (verified);
   OpenRouter has a per-account "exclude training providers" toggle the app
   should tell users to enable.

## Spikes to run before deep building (in order)

1. **Gemini browser CORS smoke test** — one HTML page, one real key, one
   `generateContent` call with an image. Decides relay-drop. (~10 min)
2. **Capacitor `.apk` hello-world** — the web build wrapped, sideloaded onto a
   real phone: file picker opens a PDF, share sheet exports a zip. (~half day)
3. **Tauri Windows hello-world** — NSIS `.exe`, install on a clean Windows
   VM, confirm the SmartScreen flow is the only friction. (~half day)
4. **Quota burn measurement** (unchanged from the doc, still the #1 risk) —
   LLM calls per real 25-page scan against Groq+Gemini free tiers. The doc
   calls this "the one number that could force a redesign"; nothing in this
   research measured it.
5. **React vs Svelte agent spike (optional)** — the framework agent suggested
   having the actual coding agent build the review-table component in both and
   comparing defect rates; only worth it if you doubt the React call.

## Confidence summary

| Finding | Confidence |
|---|---|
| Windows = Tauri 2 | High |
| Zip = fflate; hosting = Cloudflare Pages; Workers relay still $0-viable | High |
| CORS pass/fail per provider (live-tested 2026-07-09) | High |
| Android = Capacitor over Tauri | Medium-High (build the spike anyway) |
| React over Svelte/Vue for agent-written code | Medium-High (benchmark is from Apr 2025) |
| @hyzyla/pdfium memory behavior between pages | Medium (re-instantiate the WASM module every ~5–10 pages as a safety net) |
| Free-tier quota numbers | Medium — providers stopped publishing fixed numbers; re-verify at ship time |
| Gemini stays CORS-open | Unknown until smoke-tested; CORS "can change silently" cuts both ways |

_Full per-topic reports (with source URLs and dates) were produced by the six
research agents; ask to have any topic's raw findings exported if needed._
