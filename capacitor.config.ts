import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.lotfy14.codox',
  appName: 'Codox',
  webDir: 'dist',
  plugins: {
    // Android WebView (<Chromium 140) reports env(safe-area-inset-*) as 0,
    // so the CSS reads --safe-area-inset-* instead. 'css' (the default) tells
    // Capacitor's SystemBars to inject the real system-bar/cutout insets as
    // those CSS variables. Pinned here because the layout depends on it.
    SystemBars: {
      insetsHandling: 'css'
    }
  }
};

export default config;
