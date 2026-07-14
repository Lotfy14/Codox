// vitest alias target for 'virtual:pwa-register', which only exists inside
// a real Vite+PWA build. Tests override it with vi.mock.
export function registerSW(): () => void {
  return () => {}
}
