import {
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'

/**
 * PWA icon set, generated from the one logo source (public/logo.svg):
 * `npx pwa-assets-generator`. Home-screen icons render full-bleed — the
 * logo artwork carries its own midnight background — and the maskable
 * icon keeps the safe-zone padding Android requires, filled with the
 * same midnight so the tile never shows stray borders.
 */
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: {
      sizes: [64, 192, 512],
      padding: 0,
      favicons: [[48, 'favicon.ico']],
    },
    apple: {
      sizes: [180],
      padding: 0,
    },
    maskable: {
      sizes: [512],
      padding: 0.2,
      resizeOptions: { background: '#0a0f2e' },
    },
  },
  images: ['public/logo.svg'],
})
