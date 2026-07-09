# Phase 2 Build Plan — Shell Spikes: Kill the Packaging Risk

_Audience: AI coding agents. Execution unit: one task at a time, in order.
Parent plan: [../BUILD_PLAN.md](../BUILD_PLAN.md) Phase 2._

## Status

**Partially executed** (agent file-level execution started 2026-07-09).
Android Studio/JDK 21 is not installed on the local Mac, so APK assembly and
all owner device/install checks remain pending. This plan serves two modes:

- **EXECUTE mode** (default while no `android/` or `src-tauri/` exists): run
  each task's Steps, then its Acceptance checks.
- **VERIFY mode** (once shell state exists): run Acceptance checks only; fix
  failures; skip Steps that already hold.

### Results to record at execution (fill in, do not delete)

| Question | Answer | Date |
|---|---|---|
| Gemini direct browser call works (T2.8) → relay dropped for Phase 4? | **YES — HTTP 200 from the deployed origin (`codox.eriksonlegend1.workers.dev`), model `gemini-2.5-flash` via `models.generateContent`, response body returned model text. Direct browser→Gemini call works; relay dropped for Phase 4.** Widget now exposes an editable model picker (default `gemini-2.5-flash-lite`). Re-verify against Auth-type keys ~Sept 2026 (Owner flag 2). | 2026-07-09 |
| Android device proofs (T2.4): picker / share / persistence | Signed release APK built locally 2026-07-09 (JDK 21 + Android cmdline-tools installed via Homebrew, keystore in owner custody at `~/Keys/codox-release.keystore`). _Real-phone picker/share/persistence test still pending owner._ | 2026-07-09 |
| Windows install proof (T2.6): SmartScreen walk + launch | NSIS `.exe` built green on GitHub Actions 2026-07-09 (`Codox_0.1.0_x64-setup.exe`, after fixing the workflow's `tauri-action` tag to `@v1.0.0`). _SmartScreen walk + launch on a Windows machine still pending owner._ | 2026-07-09 |
| Release-link installs on both devices (T2.7) | _pending owner APK + EXE artifacts and prerelease dry run_ | 2026-07-09 |

## Package & tooling decisions (search-before-build, researched 2026-07-09)

Versions below were current on 2026-07-09; install latest-stable at
execution time unless a major bump breaks compatibility — then stop and
report.

| Concern | Decision | Version then | License | Note |
|---|---|---|---|---|
| Android shell | `@capacitor/core` + `@capacitor/cli` + `@capacitor/android` | 8.4.x | MIT | Needs Node 22+ (✓), Android Studio Otter 2025.2.1+ (bundles JDK 21), minSdk 24, compile/target SDK 36 |
| Native share | `@capacitor/share` + `@capacitor/filesystem` | 8.0.x / 8.1.x | MIT | `navigator.share({files})` is unreliable in the Android WebView — official plugins are standard practice (parent plan Phase 7 already anticipates this) |
| Dummy zip | `fflate` | 0.8.x | MIT | Already on CLAUDE.md's decided list; needed for real exports in Phase 7 anyway |
| Windows shell | `@tauri-apps/cli` (Tauri 2) | 2.11.x | MIT/Apache-2.0 | Scaffolding needs no local Rust; only builds do |
| Windows builds | GitHub Actions `windows-latest` + `tauri-apps/tauri-action` | action-v1.0.0 | MIT | Cross-compiling NSIS from macOS is officially experimental/"last resort" — build on the free CI runner instead. Actions is $0/unmetered for public repos |
| Distribution | GitHub Releases | — | — | 2 GB/asset, unmetered, anonymous downloads on public repos — fits both artifacts |
| Gemini spike call | Plain `fetch` to the REST `models.generateContent` endpoint | — | — | No SDK for a one-off spike; **must use the legacy `generateContent` path — the newer Interactions API fails browser CORS preflight** (unallowlisted `Api-Revision` header). Phase 4 decides adapters properly |
| Lint (pre-existing) | `oxlint` (dev-only) | 1.71.x | MIT | Already in `package.json` from the Phase 1 scaffold but missing from that plan's table — approved here retroactively. Do not flag or remove it |

## Owner flags (decisions/risks surfaced by research — read before executing)

1. **COST-ZERO flag — Android Developer Verification.** Google is rolling
   out developer verification for sideloaded apps: a free tier capped at
   **20 devices** (from Aug 2026) or a **one-time $25** "full distribution"
   registration (government ID required). Enforcement starts Sept 2026 in
   four countries, global through 2027. Nothing blocks Phase 2 today, and
   the known user group may fit under 20 devices — but per CLAUDE.md rule 1
   this is a price tag and needs an explicit owner decision **before Phase 8
   ships the `.apk` publicly**. Options: stay ≤ 20 devices free / pay $25
   once / lean on the PWA for Android users.
2. **Gemini key policy shift.** Google is migrating API keys
   ("Standard" → "Auth"): unrestricted Standard keys started being rejected
   June 2026 and stop working entirely ~Sept 2026. Google's docs officially
   recommend a backend proxy and warn against client-side keys — Codox's
   keys-stay-on-device rule is a deliberate, owner-chosen exception, but
   **re-verify browser CORS against Auth-type keys near Sept 2026** (T2.8
   records today's answer; Phase 4 should re-check).
3. **IndexedDB is evictable in the Android WebView.** Android can purge
   WebView storage under disk pressure or long inactivity, and
   `navigator.storage.persist()` is not guaranteed to be honored there.
   This does not change the Dexie decision — it **raises the stakes on
   export-early** (already law). T2.2 adds a persistence-grant indicator so
   the real behavior is observed on-device, and Phase 7's export design
   must assume storage can vanish.
4. **Windows Smart App Control caveat (one-liner).** On Windows 11 25H2
   machines where Smart App Control is active (mostly fresh installs), an
   unsigned `.exe` is blocked outright with no "Run anyway." The classic
   SmartScreen "More info → Run anyway" flow remains standard everywhere
   else. Phase 8's landing-page note should mention the browser-version
   fallback for such machines.

## Global rules binding every task in this plan

1. Read `/CLAUDE.md` before starting. Its hard rules override this plan on
   conflict.
2. **Never run `git commit` or `git push`.** The owner commits manually.
   When a task's output is "changes ready to commit," stop, report the file
   list, and hand off. Tasks below marked `[OWNER]` are owner-manual.
3. Do not create files outside the repo root `/Users/lotfy/Documents/GitHub/Codox`.
4. If any Acceptance check cannot be made to pass, stop and report — do not
   improvise around it.
5. **COST-ZERO gate on dependencies:** every package added in this phase
   must already appear in the decision table above with a permissive
   license. Any other package a task seems to need → stop and report.
6. **Secrets never enter git:** no keystore, keystore password, or API key
   is ever staged, committed, or written into a tracked file. The keystore
   entries in `.gitignore` (T2.3) are load-bearing — verify with
   `git check-ignore` before handing off.

## Preconditions (check before T2.1)

| Check | Command | Expected |
|---|---|---|
| Phase 1 exit gate passed | T1.1–T1.5 green (verified 2026-07-09) **and** T1.6/T1.7 owner-confirmed | deployed pages.dev URL exists (T2.8 needs it) |
| Node 22+ | `node --version` | ✓ (v26.3.0 on the dev machine) |
| Android Studio Otter 2025.2.1+ | installed, opened once (bundles JDK 21) | owner installs if missing — free |
| `keytool` reachable | `keytool -help` (ships with Studio's JDK) | exit 0 |
| gh CLI authed | `gh auth status` | "Logged in" |
| Repo public on GitHub | `gh repo view --json visibility` | `PUBLIC` (free Actions + anonymous release downloads) |
| Owner hardware for tests | real Android phone; Windows machine or VM | available |
| Owner Gemini API key | created free in AI Studio | available for T2.8 only, never stored |

---

## T2.1 — Capacitor Android platform

**Objective:** the Phase-1 web build is wrapped in a committed `android/`
project that syncs from `dist/`.

**Steps:**
1. `npm i @capacitor/core @capacitor/share @capacitor/filesystem fflate`
   and `npm i -D @capacitor/cli @capacitor/android`.
2. `npx cap init Codox <app-id>` — app id reverse-DNS, owner's domain or
   `io.github.lotfy14.codox`; `webDir: 'dist'` in `capacitor.config.ts`.
3. `npm run build && npx cap add android && npx cap sync android`.
4. `.gitignore` additions (root): `*.keystore`, `*.jks`,
   `android/keystore.properties`. (Capacitor's generated `android/.gitignore`
   already covers Gradle build outputs and `local.properties` — verify, do
   not duplicate.) The generated `android/` folder itself **is committed** —
   current Capacitor practice treats platform folders as source.
5. Add a `sync` note to `Docs/RELEASING.md` scope (T2.9 writes the file):
   every web change needs `npm run build && npx cap sync android`.

**Acceptance:**
- `npx cap sync android` → exit 0
- `test -d android/app/src/main/assets/public` → exit 0 (web bundle copied)
- `git check-ignore android/local.properties android/keystore.properties` →
  both ignored (create an empty `android/keystore.properties` test file if
  needed, then delete it)
- `git status --porcelain` shows `android/` files as addable, **no** build
  outputs (`android/app/build/`, `android/.gradle/`) listed

## T2.2 — Spike-checks widget (temporary, single codebase)

**Objective:** the three Android proofs and the Gemini check are drivable
from inside the app by a non-technical owner, with zero per-platform forks.

**This widget is scaffolding** — clearly labeled "Phase 2 spike checks,"
mounted on the Export placeholder screen, removed when Phase 3's design
pass lands. It is one codebase with **capability detection**, exactly the
adapter shape Phase 7 formalizes (parent plan already plans the share
plugin inside the `.apk`):

**Steps:**
1. **File-picker check:** `<input type="file" accept="application/pdf">` +
   a line showing the picked file's name and byte size. (Research: works
   natively in the Capacitor WebView; the non-image `accept` skips the
   camera chooser.)
2. **Share/export check:** a button that builds a dummy zip in memory with
   `fflate` (one text file inside), then exports it through one function:
   native platform (`Capacitor.isNativePlatform()`) → write to cache via
   `@capacitor/filesystem`, share via `@capacitor/share`; otherwise →
   `navigator.share({files})` when the browser reports capability, else
   anchor-download fallback. One function, capability-branched — not a
   platform fork.
3. **Persistence check:** on mount, call `navigator.storage.persist()` and
   display granted/denied plus a stored-marker timestamp (first-seen date
   read/written through Dexie) so eviction is observable across restarts.
4. **Gemini check (used in T2.8):** a password-type input for an API key
   (kept in component state only — never persisted, never logged) + a "Test
   Gemini" button: one `fetch` POST to the REST
   `models.generateContent` endpoint (current Flash-class model — verify
   the model id at execution time; **not** the Interactions API) with a
   tiny canvas-generated PNG inline; display HTTP status and the first
   ~100 chars of the response body verbatim.

**Acceptance:**
- `npm run build` → exit 0; no new deps beyond the T2.1 installs
- Manual (2 min, desktop browser): picker shows a chosen PDF's name/size;
  share button produces a downloaded/shared zip that unzips; persistence
  line renders granted/denied; Gemini button with a bogus key renders an
  HTTP error status (proves the call is wired without a real key)

## T2.3 — Self-signed keystore + signed release APK

**Objective:** a signed `.apk` exists, built by Gradle with signing config
sourced from a gitignored properties file; the keystore is in owner custody.

**Steps:**
1. Generate once, **outside the repo** (e.g. `~/Keys/codox-release.keystore`):
   `keytool -genkeypair -v -keystore codox-release.keystore -alias codox
   -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12`.
2. `android/keystore.properties` (gitignored — verify again):
   `storeFile=...`, `storePassword=...`, `keyAlias=codox`, `keyPassword=...`.
3. Wire `signingConfigs.release` in `android/app/build.gradle` to read that
   properties file, guarded so its **absence degrades to an unsigned build,
   never a broken one** (CI and fresh clones won't have it).
4. `npm run build && npx cap sync android && cd android &&
   ./gradlew assembleRelease` → `android/app/build/outputs/apk/release/`.
5. **[OWNER] keystore custody:** back up the keystore + passwords in a
   password manager. Android only accepts updates signed by the same key —
   losing it means users must uninstall/reinstall future versions.

**Acceptance:**
- signed `app-release.apk` exists (not `-unsigned`); Gradle output or
  `apksigner verify` confirms signature
- `git status --porcelain` → no keystore, no `keystore.properties`
- With `keystore.properties` temporarily renamed away: `./gradlew
  assembleRelease` still succeeds (unsigned) — then restore it

## T2.4 — [OWNER] Android device proofs

**Objective:** the parent plan's three Android proofs pass on a real phone.

**Owner steps:** transfer `app-release.apk` to the phone (Releases-link
install is T2.7; direct transfer is fine here) → allow "install unknown
apps" for the browser/file app → accept the Play Protect scan prompt →
install → then, inside the app's spike widget:
1. File picker opens the system picker and returns a real PDF (name + size
   shown).
2. Share button opens the **system share sheet** with the dummy zip;
   sharing it somewhere (e.g. to Files/Drive) yields a valid zip.
3. Persistence: note the stored-marker date, force-stop the app, reopen —
   marker and current screen survive. (Also note the persist
   granted/denied value for the Results table.)

**Acceptance (owner-verified):** all three pass; results recorded in the
table at the top of this plan.

## T2.5 — Tauri 2 scaffold + Windows CI build

**Objective:** `src-tauri/` exists as a pure wrapper and a GitHub Actions
workflow produces an NSIS `.exe` on `windows-latest`.

**Steps:**
1. `npm i -D @tauri-apps/cli` → `npx tauri init` (no local Rust needed to
   scaffold; never build locally on the Mac). Answers: app name `Codox`,
   window title `Codox`, frontend dist `../dist`, dev url the Vite default,
   before-build `npm run build`.
2. `src-tauri/tauri.conf.json`: `identifier` matching T2.1's reverse-DNS,
   `bundle.targets: ["nsis"]`, default NSIS block. No Rust logic beyond the
   generated `main.rs` — the shell stays a pure wrapper (CLAUDE.md).
3. `.gitignore`: add `src-tauri/target/` (per the Phase 0 note reserving
   this entry).
4. `.github/workflows/windows-spike.yml`: trigger `workflow_dispatch`;
   `windows-latest`; checkout → setup Node → `npm ci` → Rust toolchain →
   `tauri-apps/tauri-action@action-v1` (build only, no release upload) →
   upload the `.exe` from `src-tauri/target/release/bundle/nsis/` as a
   workflow artifact.
5. Icons: `npx tauri icon public/logo.svg` if the scaffold demands real
   icons (generated set is committed under `src-tauri/icons/`).

**Acceptance:**
- `src-tauri/tauri.conf.json` valid JSON; `npx tauri info` runs without
  fatal errors on the Mac
- `git check-ignore src-tauri/target/anything` → ignored
- workflow file lints (`gh workflow list` sees it after the owner's next
  push) — the actual green run is owner-triggered: **[OWNER]** push, run
  the workflow from the Actions tab, confirm it produces an `.exe`
  artifact ($0 — public repo)

## T2.6 — [OWNER] Windows install proof

**Objective:** the parent plan's SmartScreen walk on real Windows.

**Owner steps:** download the `.exe` artifact from the green Actions run →
copy to a clean Windows machine/VM → run → SmartScreen "Windows protected
your PC" → **More info → Run anyway** → installer completes → Codox
launches → navigate all five screens. (If the machine has Smart App
Control active — Win 11 25H2 fresh installs — the unsigned exe is blocked
with no override; note it and use another machine; see Owner flag 4.)

**Acceptance (owner-verified):** app installed and navigable; result
recorded in the Results table.

## T2.7 — [OWNER] GitHub Releases dry run

**Objective:** both artifacts install **from a Release link** on the target
devices — the real distribution path.

**Agent action:** prepare the exact commands, run nothing:
```
gh release create v0.2.0-spike --prerelease --title "Phase 2 shell spike" \
  --notes "Spike artifacts — not for real use" \
  app-release.apk Codox_<version>_x64-setup.exe
```
**Owner steps:** run it (renaming artifacts to friendly names is fine) →
on the Android phone, open the release page in the browser, download the
`.apk`, install (unknown-apps prompt again) → on Windows, download the
`.exe` from the same page, install. Delete or keep the prerelease
afterwards — owner's choice.

**Acceptance (owner-verified):** both devices installed from the release
link; result recorded in the Results table.

## T2.8 — [OWNER] Gemini direct-call check (10 min)

**Objective:** the parent plan's relay-drop decision input: does a direct
browser → Gemini `generateContent` call work from the deployed app?

**Owner steps:** create a free API key in Google AI Studio → open the
**deployed pages.dev app** (not localhost — CORS must be proven from the
real origin) → Export screen spike widget → paste key → "Test Gemini."
Expected per research: HTTP 200 with model text (the legacy endpoint
allows browser CORS; the newer Interactions API does not — the widget
targets the legacy one by construction).

**Acceptance (owner-verified):** record in the Results table: HTTP status,
model id used, date, and the verdict — **200 → relay dropped forever
(Phase 4 skips it); non-CORS failure → relay question reopens in Phase 4.**
Also re-read Owner flag 2 (Auth-key migration ~Sept 2026) when Phase 4
starts.

## T2.9 — `Docs/RELEASING.md`

**Objective:** the exact, tested build commands for each shell, written
down while fresh.

_Deviation note: the parent plan says `docs/RELEASING.md`; this repo's
folder is capitalized `Docs/` — the file goes there._

**Steps:** write `Docs/RELEASING.md` covering: web deploy (push to `main` →
Cloudflare Pages auto-build); Android (`npm run build && npx cap sync
android && cd android && ./gradlew assembleRelease`, keystore.properties
prerequisite, where the `.apk` lands); Windows (trigger
`windows-spike.yml` from the Actions tab, where the artifact lands);
release publishing (`gh release create` per T2.7); the keystore-custody
warning from T2.3.

**Acceptance:**
- `test -f Docs/RELEASING.md` → exit 0
- Every command in it was actually executed during T2.1–T2.7 (no
  aspirational commands); relative links resolve

---

## Phase exit gate

All of: T2.1–T2.3, T2.5 (file-level), T2.9 Acceptance green
(agent-verifiable) AND T2.4, T2.5 (CI run), T2.6–T2.8 confirmed by owner
AND the Results table at the top of this plan filled in. On exit, tick the
Phase 2 checkboxes in [../BUILD_PLAN.md](../BUILD_PLAN.md) (edit only —
owner commits), confirm the owner has seen the four Owner flags (the $25
Android verification one especially), and report Phase 3 (UI/UX design
pass) as next.
