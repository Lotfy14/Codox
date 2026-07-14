import { registerPlugin } from '@capacitor/core'

/**
 * Web-side handle for the Android-only ApkInstallerPlugin (see
 * android/app/src/main/java/io/github/lotfy14/codox/ApkInstallerPlugin.java).
 * `install` opens the system package-installer dialog on an APK already on
 * disk; it rejects with code PERMISSION_DENIED when the user declines the
 * "unknown sources" toggle Android requires for a sideloaded update.
 */
export interface ApkInstallerPlugin {
  canInstall(): Promise<{ granted: boolean }>
  install(options: { path: string }): Promise<void>
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller')
