package io.github.lotfy14.codox;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

