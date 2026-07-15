/**
 * Update detection for the platforms that do not refresh themselves the way
 * the web app does. The web app updates through its service worker, so this is
 * a no-op there. Windows (Tauri) has a signed, silent updater. Android checks
 * GitHub for a newer release on launch and, when the user taps the banner,
 * downloads that release's APK and opens the system installer — Android never
 * installs a sideloaded app silently, so it needs one confirming tap (and
 * "install from unknown sources" allowed once). `url` is the manual fallback
 * for when that install is refused. The Android check reads the release's
 * latest.json over github.com rather than the rate-limited api.github.com, so
 * the banner appears reliably. See UpdateBanner.tsx.
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

  // Android: no SILENT updater. Read the newest release's latest.json from
  // github.com (NOT the rate-limited api.github.com) so the check is reliable,
  // then offer that release's APK. Web returns here too (not native) — no banner.
  const { Capacitor, CapacitorHttp } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) return null
  try {
    const res = await CapacitorHttp.get({
      url: `https://github.com/${REPO}/releases/latest/download/latest.json`,
    })
    if (res.status < 200 || res.status >= 300) return null
    const manifest = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as { version?: string }
    const latest = String(manifest?.version ?? '').replace(/^v/, '')
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
