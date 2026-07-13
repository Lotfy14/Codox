package io.github.lotfy14.codox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Launches the real Capacitor activity and proves its bundled web app renders. */
@RunWith(AndroidJUnit4.class)
public class MainActivitySmokeTest {

    @Test
    public void launchesCodoxWebApp() throws Exception {
        assertEquals(
            "io.github.lotfy14.codox",
            InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName()
        );

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> title = new AtomicReference<>();
            AtomicReference<String> url = new AtomicReference<>();
            AtomicInteger progress = new AtomicInteger();
            boolean appLoaded = false;

            // GitHub-hosted emulators can be slow, especially if KVM is unavailable.
            // Wait through native WebView state before querying JavaScript to avoid a startup race.
            for (int attempt = 0; attempt < 120 && !appLoaded; attempt += 1) {
                scenario.onActivity(activity -> {
                    WebView webView = activity.getBridge().getWebView();
                    title.set(webView.getTitle());
                    url.set(webView.getUrl());
                    progress.set(webView.getProgress());
                });

                appLoaded = "Codox".equals(title.get())
                    && url.get() != null
                    && url.get().startsWith("https://localhost")
                    && progress.get() == 100;
                if (!appLoaded) Thread.sleep(500);
            }

            assertTrue(
                "The Codox WebView did not finish loading. title=" + title.get()
                    + ", url=" + url.get()
                    + ", progress=" + progress.get(),
                appLoaded
            );

            CountDownLatch evaluated = new CountDownLatch(1);
            AtomicReference<String> bodyContainsBrand = new AtomicReference<>("false");
            scenario.onActivity(activity -> {
                WebView webView = activity.getBridge().getWebView();
                webView.evaluateJavascript(
                    "Boolean(document.body && document.body.innerText.includes('Codox'))",
                    value -> {
                        bodyContainsBrand.set(value);
                        evaluated.countDown();
                    }
                );
            });

            assertTrue(
                "The loaded Codox WebView did not respond to JavaScript",
                evaluated.await(30, TimeUnit.SECONDS)
            );
            assertEquals("The Codox interface did not render", "true", bodyContainsBrand.get());
        }
    }
}
