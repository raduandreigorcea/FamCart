package com.famcart.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that ship as npm packages are discovered from their own
        // manifests; one living in the app module is not, so it has to be named
        // here — and before super.onCreate(), which is where the bridge is built
        // and the plugin list is read. Registered after it, AppInstaller exists in
        // the APK but not in the WebView, and the update dialog reports that it
        // cannot install anything.
        registerPlugin(AppInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
