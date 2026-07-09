# Releasing Codox

This file records the Phase 2 shell-spike release paths.

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
  Gradle.
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

The Windows shell is built on GitHub Actions, not locally on macOS.

Owner steps:

1. Push the branch containing `.github/workflows/windows-spike.yml`.
2. Open the GitHub Actions tab.
3. Run the `Windows shell spike` workflow manually.
4. Download the `codox-windows-nsis` artifact.

The workflow uploads the NSIS installer from:

```text
src-tauri/target/release/bundle/nsis/*.exe
```

## GitHub Release Dry Run

After the Android APK and Windows installer exist, the owner can publish a
prerelease from the repo root:

```sh
gh release create v0.2.0-spike --prerelease --title "Phase 2 shell spike" \
  --notes "Spike artifacts -- not for real use" \
  app-release.apk Codox_<version>_x64-setup.exe
```

Install both artifacts from the GitHub Release page on the target devices before
using this path for real distribution.
