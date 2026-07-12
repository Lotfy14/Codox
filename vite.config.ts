import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
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
      'brand-logo.png',
    ],
    manifest: {
      name: 'Codox',
      short_name: 'Codox',
      description:
        'Convert exam PDFs into Triviadox-ready CSV bundles entirely client-side.',
      display: 'standalone',
      // theme_color stays burgundy (brand) per the port plan; the splash
      // background matches the cream stage.
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
  }), cloudflare()],
})