import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  // The pdf.js worker wrapper (src/pdf/pdfjsWorker.ts) uses top-level await +
  // dynamic import to polyfill Promise.try before loading pdf.js's worker, so
  // it must build as an ES module. pdf.js also always creates its worker with
  // { type: 'module' }, so this is the format it expects.
  worker: { format: 'es' },
  // @jsquash/jpeg ships Emscripten glue that fetches its .wasm relative to
  // import.meta.url. Vite's dep optimizer rewrites that and breaks the load
  // ("Failed to construct 'URL'"), so the package must stay unbundled.
  optimizeDeps: { exclude: ['@jsquash/jpeg'] },
  define: {
    // CI stamps VERSION (0.0.<run>) into the build so the Android banner can
    // compare it against the newest GitHub release; package.json for dev.
    __APP_VERSION__: JSON.stringify(process.env.VERSION ?? pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: a new deploy replaces the cached app-shell on next
      // launch. 'prompt' with a console-only handler left users pinned to
      // stale UI forever (bit the owner on 2026-07-12).
      registerType: 'autoUpdate',
      workbox: {
        // pdfium.wasm (~4 MB) must precache or the offline PWA cannot
        // render PDFs; workbox's default limit is 2 MB.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon-180x180.png',
        'logo.svg',
      ],
      manifest: {
        name: 'Codox',
        short_name: 'Codox',
        description:
          'Convert exam PDFs into Triviadox-ready CSV bundles entirely client-side.',
        display: 'standalone',
        // theme_color stays burgundy (brand); the splash background
        // matches the cream stage.
        theme_color: '#800020',
        background_color: '#f4e9e0',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
