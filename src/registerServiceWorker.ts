import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'

// The service worker exists for the web channel only (offline PWA). The
// Tauri and Capacitor shells load assets from the app binary, so a SW buys
// nothing there — and inside the Tauri WebView its update fetches fail,
// pinning the UI to a stale precache that survives reinstalls (froze the
// Windows app at the 2026-07-12 build, found 2026-07-14). Never register
// one in a shell, and actively remove any left by older builds.
const inNativeShell =
  '__TAURI_INTERNALS__' in window || Capacitor.isNativePlatform()

if (inNativeShell) {
  void navigator.serviceWorker?.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister()
  })
  if (typeof caches !== 'undefined') {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key)
    })
  }
} else {
  registerSW({
    onOfflineReady() {
      console.log('Codox is ready to work offline.')
    },
  })
}
