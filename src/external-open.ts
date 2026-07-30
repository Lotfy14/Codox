/**
 * Open a URL in the user's real browser.
 *
 * The Tauri desktop shell (WebView2) silently ignores `window.open` and
 * `<a target="_blank">` — nothing opens. It needs the opener plugin to hand
 * the URL to the OS. Web and the Capacitor Android WebView open a new tab
 * the normal way, so they keep `window.open`. Detection mirrors updater.ts:
 * `__TAURI_INTERNALS__` is present only inside the Tauri shell.
 *
 * The opener plugin needs TWO capability entries, and having only the obvious
 * one made every desktop "Export to Triviadox" a no-op: `opener:allow-open-url`
 * enables the *command*, but `open_url` then checks the URL against a *scope*
 * that is empty unless `opener:allow-default-urls` (http/https/mailto/tel) is
 * also granted — so the call rejected with ForbiddenUrl, fell through to
 * `window.open`, and WebView2 swallowed it in silence while the UI still said
 * "Opening Triviadox…". Both entries are in `src-tauri/capabilities/default.json`;
 * removing either one brings the silent failure back. Hence the warn below —
 * the fallback stays (a plugin fault must never dead-end) but never goes quiet.
 */
export async function openExternal(url: string): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch (err) {
      // Fall through to window.open so a plugin failure never dead-ends —
      // but say so, because in WebView2 that fallback opens nothing at all.
      console.warn('[codox] opener plugin failed, falling back to window.open', err)
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
