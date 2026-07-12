/**
 * Windows auto-update: inside the Tauri shell, check GitHub Releases on
 * startup, install silently, and relaunch. The check runs in the first
 * seconds after launch — before any conversion work can be in flight —
 * so an immediate relaunch never interrupts a run. The web app is not
 * touched by this: it updates through its service worker instead.
 */
export async function applyPendingUpdate(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (update === null) return
    await update.downloadAndInstall()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    // Never block or break launch over an update; the next start retries.
  }
}
