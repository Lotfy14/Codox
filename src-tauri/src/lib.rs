// Older builds registered the PWA service worker inside the WebView2 shell,
// where its update fetches fail: the SW then serves a frozen precache
// forever, and that cache lives in the WebView2 profile, which reinstalls
// never touch (pinned the Windows app to the 2026-07-12 build). The frontend
// no longer registers a SW in shells, but a trapped webview only ever runs
// the frozen JS — so the binary must clear the poisoned state before the
// webview starts. Idempotent: the dir stays absent once healed.
#[cfg(windows)]
fn wipe_stale_service_worker() {
  if let Some(local) = std::env::var_os("LOCALAPPDATA") {
    let dir = std::path::Path::new(&local)
      .join("io.github.lotfy14.codox") // bundle identifier (tauri.conf.json)
      .join("EBWebView")
      .join("Default")
      .join("Service Worker");
    let _ = std::fs::remove_dir_all(dir);
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(windows)]
  wipe_stale_service_worker();

  let builder = tauri::Builder::default();

  // Desktop-only auto-update: the frontend checks GitHub Releases on
  // startup, installs silently, and relaunches (see src/updater.ts).
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
