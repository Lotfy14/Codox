/**
 * Update detection for the two frozen channels. The web app updates itself
 * through its service worker, so this is a no-op there. Windows (Tauri) has a
 * signed silent updater; Android has no updater at all, so an installed APK
 * stays frozen until a fresh one from GitHub Releases is installed over it.
 * On Android `install` downloads that APK and opens the system installer
 * dialog — Android never installs a sideloaded app silently — and `url` stays
 * as the manual fallback for when it refuses. See UpdateBanner.tsx.
 */
const REPO = 'Lotfy14/Codox'

export type UpdateInfo =
  | { platform: 'windows'; version: string; install: () => Promise<void> }
  | {
      platform: 'android'
      version: string
      url: string
      install: () => Promise<void>
    }

/** True when `latest` is a higher dotted-numeric version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // Windows: the Tauri updater knows whether a newer signed release exists.
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update === null) return null
      return {
        platform: 'windows',
        version: update.version,
        install: async () => {
          await update.downloadAndInstall()
          const { relaunch } = await import('@tauri-apps/plugin-process')
          await relaunch()
        },
      }
    } catch {
      return null // Never break launch over an update check.
    }
  }

  // Android: no updater, so compare our build version to the newest release.
  // Web returns here too (not a native platform) and never shows a banner.
  const { Capacitor } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) return null
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
    )
    if (!res.ok) return null
    const { tag_name } = (await res.json()) as { tag_name?: string }
    const latest = String(tag_name ?? '').replace(/^v/, '')
    if (!latest || !isNewer(latest, __APP_VERSION__)) return null
    const url = `https://github.com/${REPO}/releases/download/v${latest}/codox-${latest}.apk`
    return {
      platform: 'android',
      version: latest,
      url,
      install: () => downloadAndInstallApk(url, latest),
    }
  } catch {
    return null
  }
}

/**
 * Downloads the release APK to the app's cache — where the manifest's
 * FileProvider can hand it out — then opens the package installer on it.
 * Filesystem streams the file to disk natively, so a ~50 MB APK never lands
 * in the WebView's heap.
 */
async function downloadAndInstallApk(
  url: string,
  version: string,
): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { ApkInstaller } = await import('./apk-installer.ts')
  const { path } = await Filesystem.downloadFile({
    url,
    path: `codox-${version}.apk`,
    directory: Directory.Cache,
  })
  if (path === undefined) throw new Error('The update did not download.')
  await ApkInstaller.install({ path })
}
