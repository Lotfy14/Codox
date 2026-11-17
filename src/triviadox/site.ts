/**
 * Which Triviadox site Codox talks to: the live site, or beta for testing a
 * change end to end before it reaches the live site (owner rule, 2026-11-17:
 * Key facts are tested on beta first). Chosen in Diagnostics; every Triviadox
 * call (Export to Triviadox and the Key facts area) reads it.
 *
 * Kept in localStorage, not IndexedDB, because the export path reads the
 * origin synchronously. It is a per-device convenience: losing it just means
 * the live site again.
 */

export type TriviadoxSite = 'production' | 'beta'

const STORAGE_KEY = 'codox.triviadoxSite'

export const TRIVIADOX_ORIGINS: Record<TriviadoxSite, string> = {
  production: 'https://triviadox.com',
  beta: 'https://beta.triviadox.com',
}

export function getTriviadoxSite(): TriviadoxSite {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'beta' ? 'beta' : 'production'
  } catch {
    return 'production'
  }
}

export function setTriviadoxSite(site: TriviadoxSite): void {
  try {
    if (site === 'production') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, site)
  } catch {
    // Storage blocked: the live site stays in use.
  }
}

/**
 * The origin every Triviadox request goes to. Local dev (the Vite server on
 * localhost) talks to beta. Match the hostname exactly, never a
 * substring: the Tauri desktop webview serves the app from
 * `http://tauri.localhost`, which *contains* "localhost" but is NOT the dev
 * server. A substring check there once pointed every desktop export at a
 * nonexistent `http://localhost:3000`.
 */
export function triviadoxOrigin(): string {
  if (typeof window === 'undefined') return TRIVIADOX_ORIGINS.production
  // Choosing beta wins everywhere, including a local dev server, so a change
  // can be tried against beta.triviadox.com without running Triviadox too.
  if (getTriviadoxSite() === 'beta') return TRIVIADOX_ORIGINS.beta
  const { hostname, protocol } = window.location
  const isLocalDev =
    (protocol === 'http:' || protocol === 'https:') &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  // A local dev server has no Triviadox of its own beside it, so it talks to
  // beta: changes are tried there before they reach the live site.
  return isLocalDev ? TRIVIADOX_ORIGINS.beta : TRIVIADOX_ORIGINS[getTriviadoxSite()]
}
