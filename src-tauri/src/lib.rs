#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
