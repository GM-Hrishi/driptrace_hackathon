package com.ivfluidwatch.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * Hosts the nurse app (mobile/, built into assets/web by `npm run build:app`).
 *
 * The bundle is served from https://appassets.androidplatform.net through
 * WebViewAssetLoader rather than file://, so ES modules, IndexedDB (Firebase
 * Auth persistence) and the Firebase WebSocket all run on a normal secure
 * origin, and file access stays switched off.
 */
public class MainActivity extends AppCompatActivity {

    static final String EXTRA_BED_ID = "bedId";

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/assets/web/index.html";
    private static final int PERMISSION_REQ_CODE = 200;

    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    private WebView webView;
    private SharedPreferences sharedPreferences;
    private boolean pageReady = false;
    private String pendingBedId = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        current = new WeakReference<>(this);

        sharedPreferences = getSharedPreferences(WardStore.PREFS, Context.MODE_PRIVATE);
        MonitorService.createChannels(this);
        requestNotificationPermission();

        webView = findViewById(R.id.webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // The in-app alarm tone must be able to sound without a tap first.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The app never navigates away from its own bundle.
                return !ASSET_HOST.equals(request.getUrl().getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageReady = true;
                if (pendingBedId != null) {
                    openBed(pendingBedId);
                    pendingBedId = null;
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    // Keep the ward loaded in the background instead of destroying it.
                    moveTaskToBack(true);
                }
            }
        });

        pendingBedId = getIntent().getStringExtra(EXTRA_BED_ID);
        webView.loadUrl(START_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String bedId = intent.getStringExtra(EXTRA_BED_ID);
        if (bedId == null) return;
        if (pageReady) openBed(bedId);
        else pendingBedId = bedId;
    }

    private void openBed(String bedId) {
        webView.evaluateJavascript("location.hash = " + JSONObject.quote("#/bed/" + bedId) + ";", null);
    }

    private void dispatch(String type) {
        if (webView == null) return;
        String detail = "{\"type\":" + JSONObject.quote(type) + "}";
        webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('driptrace:native', { detail: " + detail + " }));", null);
    }

    /** An Acknowledge on a notification: let the open app pick it up now. */
    static void notifyStoreChanged() {
        MainActivity activity = current.get();
        if (activity != null) activity.runOnUiThread(() -> activity.dispatch("store-changed"));
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQ_CODE);
        }
    }

    /** Called from JavaScript on a binder thread; anything touching views hops to the UI thread. */
    public class WebAppInterface {

        @JavascriptInterface
        public void saveSetting(String key, String value) {
            sharedPreferences.edit().putString(key, value).apply();
        }

        @JavascriptInterface
        public String getSetting(String key, String defaultValue) {
            return sharedPreferences.getString(key, defaultValue);
        }

        /** Acks queued from notifications, handed over once and then cleared. */
        @JavascriptInterface
        public String takeInbox() {
            return WardStore.takeInbox(MainActivity.this);
        }

        @JavascriptInterface
        public void storeChanged() {
            MonitorService.poke();
        }

        @JavascriptInterface
        public void setMonitoring(boolean enabled) {
            if (enabled) MonitorService.start(MainActivity.this);
            else MonitorService.stop(MainActivity.this);
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean enabled) {
            runOnUiThread(() -> {
                if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public boolean notificationsEnabled() {
            return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(i);
            } catch (RuntimeException e) {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", getPackageName(), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        }

        /** @param patternJson on/off durations in ms, e.g. "[300,150,300]". */
        @JavascriptInterface
        public void vibratePattern(String patternJson) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            long[] timings;
            try {
                JSONArray a = new JSONArray(patternJson);
                timings = new long[a.length() + 1]; // leading 0 = start immediately
                for (int i = 0; i < a.length(); i++) timings[i + 1] = Math.max(0, Math.min(2000, a.getLong(i)));
            } catch (JSONException e) {
                return;
            }
            v.vibrate(VibrationEffect.createWaveform(timings, -1));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        MonitorService.appInForeground = true;
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        MonitorService.appInForeground = false;
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
