/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

export {}

declare global {
  /** Build version, stamped from the CI `VERSION` env or package.json. */
  const __APP_VERSION__: string
}
