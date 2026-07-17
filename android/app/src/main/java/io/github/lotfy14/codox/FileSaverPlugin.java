package io.github.lotfy14.codox;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String path = call.getString("path");
        String fileName = call.getString("fileName");

        if (path == null || fileName == null) {
            call.reject("Missing path or fileName parameter");
            return;
        }

        File srcFile = resolve(path);
        if (!srcFile.exists()) {
            call.reject("Source file does not exist: " + path);
            return;
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri destinationUri = null;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

                destinationUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            } else {
                File downloadFolder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadFolder.exists() && !downloadFolder.mkdirs()) {
                    throw new Exception("Failed to create Downloads folder");
                }
                File destFile = new File(downloadFolder, fileName);
                destinationUri = Uri.fromFile(destFile);
            }

            if (destinationUri == null) {
                throw new Exception("Could not resolve destination URI");
            }

            try (InputStream in = new FileInputStream(srcFile);
                 OutputStream out = resolver.openOutputStream(destinationUri)) {
                byte[] buffer = new byte[1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }

            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to save file: " + e.getMessage(), e);
        }
    }

    private File resolve(String path) {
        if (path.startsWith("file://")) {
            String parsed = Uri.parse(path).getPath();
            return new File(parsed == null ? path : parsed);
        }
        return new File(path);
    }
}
