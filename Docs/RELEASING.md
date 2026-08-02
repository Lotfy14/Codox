# Releasing Codox

How each channel is built and shipped. One push to `main` ships all of them —
see CLAUDE.md, "Ship everywhere or nowhere".

## Automated builds (every push to main)

`.github/workflows/auto-release.yml` runs on every push to `main`: it runs
lint, the unit/integration suite, critical Playwright browser journeys, and an
Android-emulator launch check; then it builds the Tauri NSIS installer and a
debug APK and publishes them as full release `v0.0.<run-number>`. The APK is
still a test build — the signed release APK below remains an owner step.
`.github/workflows/windows-spike.yml` is the manually-dispatched variant of
the Windows build.

## Web

Cloudflare Pages deploys the web app automatically when the owner pushes to
`main`.

Local build check:

```sh
npm run build
```

## Android

Every web change must be copied into the native shell before building:

```sh
npm run build && npx cap sync android
```

Release APK command:

```sh
cd android && ./gradlew assembleRelease
```

Prerequisites:

- Android Studio Otter 2025.2.1 or newer, or another JDK 21 setup available to
  Gradle. The wrapper's Gradle rejects newer JDKs (JDK 25 fails with
  "Unsupported class file major version 69") — point `JAVA_HOME` at a JDK 21,
  e.g. Android Studio's bundled one:
  `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`.
- An Android SDK visible to Gradle: set `ANDROID_HOME`
  (e.g. `%LOCALAPPDATA%\Android\Sdk`) or write `sdk.dir` into the
  gitignored `android/local.properties`.
- `android/keystore.properties`, which is gitignored, when building a signed
  release APK.
- A release keystore stored outside the repo and backed up by the owner.

`android/keystore.properties` shape:

```properties
storeFile=/absolute/path/to/codox-release.keystore
storePassword=...
keyAlias=codox
keyPassword=...
```

The signed APK lands in:

```text
android/app/build/outputs/apk/release/app-release.apk
```

If `android/keystore.properties` is missing, Gradle should still assemble an
unsigned release build for fresh clones and CI checks. Do not publish unsigned
APK artifacts.

Keep the keystore and passwords in owner custody. Android only accepts app
updates signed by the same key; losing the key means users must uninstall and
reinstall future builds.

## Windows

The Windows shell is built on GitHub Actions — `auto-release.yml` does it on
every push to `main`, so the steps below are only for a manual out-of-band
build (no local Rust toolchain needed).

Owner steps:

1. Push the branch containing `.github/workflows/windows-spike.yml`.
2. Open the GitHub Actions tab.
3. Run the `Windows shell spike` workflow manually.
4. Download the `codox-windows-nsis` artifact.

The workflow uploads the NSIS installer from:

```text
src-tauri/target/release/bundle/nsis/*.exe
```

## Publishing a release by hand

Releases normally come from `auto-release.yml` on every push to `main`
(`v0.0.<run-number>`), and that is the path the Windows auto-updater and the
Android update banner read. Publish by hand only for an out-of-band build:

```sh
gh release create v0.0.<n> --title "Codox v0.0.<n>" \
  --notes "<what changed>" \
  app-release.apk Codox_<version>_x64-setup.exe
```

Install both artifacts from the GitHub Release page on real devices before
relying on that build. Note the signing-key boundary: an APK signed with a
different key than the installed one cannot upgrade in place — the user must
uninstall first (this happened once at v0.0.51).
