package io.github.lotfy14.codox;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Hands a downloaded APK to Android's package installer.
 *
 * Android has no updater for a sideloaded app and never installs one silently:
 * the most an app may do is open the system "Do you want to update this app?"
 * dialog on a file it downloaded. That is what this does, so the update banner
 * can go straight from Update to the installer instead of leaving an APK in
 * Downloads for the user to find.
 *
 * Installing from outside a store needs the per-app "unknown sources" toggle
 * (Android 8+). When it is off we send the user to that settings screen and
 * resume the install when they come back, so a first update is one round trip
 * rather than a dead end.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    /** Thrown back to the web layer when the user declines "unknown sources". */
    private static final String PERMISSION_DENIED = "PERMISSION_DENIED";

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isInstallAllowed());
        call.resolve(result);
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (call.getString("path") == null) {
            call.reject("No APK path was given.");
            return;
        }
        if (isInstallAllowed()) {
            launchInstaller(call);
            return;
        }
        Intent settings = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startActivityForResult(call, settings, "unknownSourcesResult");
    }

    @ActivityCallback
    private void unknownSourcesResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        // The settings screen reports RESULT_CANCELED even when the toggle was
        // flipped, so ask the package manager rather than trusting the result.
        if (!isInstallAllowed()) {
            call.reject("Installing updates is not allowed for Codox.", PERMISSION_DENIED);
            return;
        }
        launchInstaller(call);
    }

    private void launchInstaller(PluginCall call) {
        File apk = resolve(call.getString("path"));
        if (!apk.exists()) {
            call.reject("The downloaded update is missing: " + apk.getPath());
            return;
        }
        Uri content = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent installer = new Intent(Intent.ACTION_VIEW);
        installer.setDataAndType(content, "application/vnd.android.package-archive");
        installer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getContext().startActivity(installer);
        } catch (ActivityNotFoundException missing) {
            call.reject("This device has no package installer.");
            return;
        }
        call.resolve();
    }

    /** Filesystem hands back either a bare path or a file:// URI; take both. */
    private File resolve(String path) {
        if (path.startsWith("file://")) {
            String parsed = Uri.parse(path).getPath();
            return new File(parsed == null ? path : parsed);
        }
        return new File(path);
    }

    private boolean isInstallAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        return getContext().getPackageManager().canRequestPackageInstalls();
    }
}
