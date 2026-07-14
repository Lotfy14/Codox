/// <reference types="vite-plugin-pwa/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/**
 * The service worker is web-only. Inside the Tauri/Capacitor shells it must
 * never register — a SW whose update fetches fail inside the shell webview
 * pins the UI to a stale precache that survives reinstalls (froze the
 * Windows app at the 2026-07-12 build). Existing registrations and caches
 * must be actively removed there.
 */

const registerSW = vi.fn()
vi.mock('virtual:pwa-register', () => ({
  registerSW: (...args: unknown[]) => registerSW(...args),
}))

let nativePlatform = false
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativePlatform },
}))

const unregister = vi.fn()
const deletedCaches: string[] = []

beforeEach(() => {
  vi.resetModules()
  registerSW.mockClear()
  unregister.mockClear()
  deletedCaches.length = 0
  nativePlatform = false
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistrations: () => Promise.resolve([{ unregister }]),
    },
  })
  vi.stubGlobal('caches', {
    keys: () => Promise.resolve(['workbox-precache-v2']),
    delete: (key: string) => {
      deletedCaches.push(key)
      return Promise.resolve(true)
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

it('registers the service worker on the plain web', async () => {
  await import('./registerServiceWorker')
  await flush()
  expect(registerSW).toHaveBeenCalledOnce()
  expect(unregister).not.toHaveBeenCalled()
})

it('never registers inside Tauri and removes any existing worker', async () => {
  Reflect.set(window, '__TAURI_INTERNALS__', {})
  await import('./registerServiceWorker')
  await flush()
  expect(registerSW).not.toHaveBeenCalled()
  expect(unregister).toHaveBeenCalled()
  expect(deletedCaches).toContain('workbox-precache-v2')
})

it('never registers inside the Capacitor shell', async () => {
  nativePlatform = true
  await import('./registerServiceWorker')
  await flush()
  expect(registerSW).not.toHaveBeenCalled()
  expect(unregister).toHaveBeenCalled()
})
