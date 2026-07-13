package io.github.lotfy14.codox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
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
            boolean foundBrand = false;
            for (int attempt = 0; attempt < 40 && !foundBrand; attempt += 1) {
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
                assertTrue("The Codox WebView stopped responding", evaluated.await(2, TimeUnit.SECONDS));
                foundBrand = "true".equals(bodyContainsBrand.get());
                if (!foundBrand) Thread.sleep(500);
            }
            assertTrue("The Codox WebView did not finish rendering", foundBrand);
        }
    }
}
