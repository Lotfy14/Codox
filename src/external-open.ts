/**
 * Open a URL in the user's real browser.
 *
 * The Tauri desktop shell (WebView2) silently ignores `window.open` and
 * `<a target="_blank">` — nothing opens. It needs the opener plugin to hand
 * the URL to the OS. Web and the Capacitor Android WebView open a new tab
 * the normal way, so they keep `window.open`. Detection mirrors updater.ts:
 * `__TAURI_INTERNALS__` is present only inside the Tauri shell.
 */
export async function openExternal(url: string): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch {
      // Fall through to window.open so a plugin failure never dead-ends.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
