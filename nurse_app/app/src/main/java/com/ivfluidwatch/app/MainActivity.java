package com.ivfluidwatch.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.net.Uri;
import android.os.PowerManager;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.JavascriptInterface;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import org.json.JSONObject;
import androidx.webkit.WebViewAssetLoader;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Handler;
import android.os.Looper;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    public static final String EXTRA_BED_ID = "bedId";
    public static void notifyStoreChanged() { /* Optional update trigger for WebView */ }


    private static final String CHANNEL_ID = "driptrace_alerts_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final int PERMISSION_REQ_CODE = 200;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private SharedPreferences sharedPreferences;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        sharedPreferences = getSharedPreferences("DripTracePrefs", Context.MODE_PRIVATE);
        createNotificationChannel();
                requestNotificationPermission();

        // Start Foreground Service
        Intent serviceIntent = new Intent(this, MonitorService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (RuntimeException e) {
            android.util.Log.w("DripTraceMonitor", "Could not start monitoring", e);
        }

        // Request battery exemption
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                Intent intent = new Intent();
                intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                                try {
                    startActivity(intent);
                } catch (Exception e) {
                    // Ignore if device doesn't support this intent
                }
            }
        }

        swipeRefresh = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);  // alarm tone without a tap
        webSettings.setDatabaseEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Native bridge for notifications and hardware feedback
        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

                final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                swipeRefresh.setRefreshing(false);
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "DripTrace Alerts";
            String description = "Alerts for IV flow deviation, bottle empty, and critical vitals";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, importance);
            channel.setDescription(description);
            channel.enableVibration(true);
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQ_CODE);
            }
        }
    }

    public class WebAppInterface {
        @JavascriptInterface
        public void openWifiSettings() {
            Intent intent = new Intent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                intent.setAction(Settings.Panel.ACTION_WIFI);
            } else {
                intent.setAction(Settings.ACTION_WIFI_SETTINGS);
            }
            startActivity(intent);
        }

        @JavascriptInterface
        public void startLocal() {
            runOnUiThread(() -> {
                if (localDeviceClient == null) {
                    localDeviceClient = new LocalDeviceClient(MainActivity.this, new LocalDeviceClient.Callback() {
                        @Override
                        public void onLive(String json) {
                            runOnUiThread(() -> webView.evaluateJavascript("window.onLocalLive(" + JSONObject.quote(json) + ");", null));
                        }
                        @Override
                        public void onHistory(String json) {
                            runOnUiThread(() -> webView.evaluateJavascript("window.onLocalHistory(" + JSONObject.quote(json) + ");", null));
                        }
                        @Override
                        public void onStatus(String status) {
                            runOnUiThread(() -> webView.evaluateJavascript("window.onLocalStatus(" + JSONObject.quote(status) + ");", null));
                        }
                    });
                }
                localDeviceClient.start();
            });
        }

        @JavascriptInterface
        public void stopLocal() {
            runOnUiThread(() -> {
                if (localDeviceClient != null) {
                    localDeviceClient.stop();
                    localDeviceClient = null;
                }
            });
        }
        private LocalDeviceClient localDeviceClient;

        public void triggerAlert(String title, String message, String severity) {
            triggerVibration(severity.equalsIgnoreCase("critical") ? 800 : 350);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.stat_notify_error)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true);

            NotificationManager notificationManager =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, builder.build());
            }
        }

        @JavascriptInterface
        public void triggerVibration(long ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            }
        }

        /** Acknowledge from the in-app alarm popup: same store as the notification button. */
        @JavascriptInterface
        public void ackAlert(String bedId, String kind, String label, String severity, String reason) {
            WardStore.queueAck(MainActivity.this, bedId, label, kind, severity, reason);
            MonitorService.poke();
        }

        /** {bedId: {kind, at}} for every acknowledged alarm, from the app or a notification. */
        @JavascriptInterface
        public String getAcks() {
            return WardStore.pendingAcks(MainActivity.this).toString();
        }

        @JavascriptInterface
        public void saveSetting(String key, String value) {
            sharedPreferences.edit().putString(key, value).apply();
        }

        @JavascriptInterface
        public String getSetting(String key, String defaultValue) {
            return sharedPreferences.getString(key, defaultValue);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        MonitorService.appInForeground = true;  // the in-app popup sounds instead
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("if(window.onAppResume) window.onAppResume();", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        MonitorService.appInForeground = false;
        if (webView != null) {
            webView.evaluateJavascript("if(window.onAppPause) window.onAppPause();", null);
            webView.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}









