package com.ivfluidwatch.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocalDeviceClient {

    public interface Callback {
        void onLive(String json);
        void onHistory(String json);
        void onStatus(String status);
    }

    private final Context context;
    private final Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean isRunning = false;
    private Network boundNetwork = null;
    
    private long lastReadingTime = 0;
    private String lastError = "connecting";
    private int historyTick = 0;
    private ConnectivityManager.NetworkCallback networkCallback;

    public LocalDeviceClient(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
    }

    public void start() {
        if (isRunning) return;
        isRunning = true;

        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .build();
                
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                boundNetwork = network;
            }
            @Override
            public void onLost(Network network) {
                if (boundNetwork != null && boundNetwork.equals(network)) {
                    boundNetwork = null;
                }
            }
        };
        try {
            cm.requestNetwork(request, networkCallback);
        } catch (RuntimeException e) {
            // Never crash the app over Wi-Fi binding; report it on the status line instead.
            networkCallback = null;
            lastError = "cannot use Wi-Fi (" + e.getClass().getSimpleName() + ")";
        }

        executor.execute(this::pollLoop);
    }

    public void stop() {
        isRunning = false;
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            try { cm.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
            networkCallback = null;
        }
    }

    private void pollLoop() {
        while (isRunning) {
            long loopStart = System.currentTimeMillis();
            updateStatus();

            if (boundNetwork != null) {
                // Fetch Live
                String liveJson = fetch("http://192.168.4.1/api/live");
                if (liveJson != null) {
                    lastReadingTime = System.currentTimeMillis();
                    lastError = "reachable";
                    handler.post(() -> callback.onLive(liveJson));
                }

                // Fetch History
                if (historyTick == 0) {
                    String histJson = fetch("http://192.168.4.1/api/history?min=120");
                    if (histJson != null) {
                        handler.post(() -> callback.onHistory(histJson));
                    }
                }
                historyTick = (historyTick + 1) % 30; // Every 30 seconds
            } else {
                lastError = "no wifi route";
            }

            long elapsed = System.currentTimeMillis() - loopStart;
            long sleepTime = 1000 - elapsed;
            if (sleepTime > 0) {
                try { Thread.sleep(sleepTime); } catch (InterruptedException ignored) {}
            }
        }
    }

    private String fetch(String urlStr) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) boundNetwork.openConnection(url);
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2000);
            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) sb.append(line);
            in.close();
            conn.disconnect();
            return sb.toString();
        } catch (Exception e) {
            lastError = "no reply (" + e.getClass().getSimpleName() + ")";
            return null;
        }
    }

    private void updateStatus() {
        String ssid = "not connected";
        WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            WifiInfo info = wifiManager.getConnectionInfo();
            if (info != null && info.getSSID() != null && !info.getSSID().equals("<unknown ssid>")) {
                ssid = info.getSSID().replace("\"", "");
            }
        }

        long ago = lastReadingTime > 0 ? (System.currentTimeMillis() - lastReadingTime) / 1000 : -1;
        String agoStr = ago >= 0 ? ago + " s ago" : "never";
        
        String status = "Wi-Fi: " + ssid + " · Device: " + lastError + " · last reading " + agoStr;
        handler.post(() -> callback.onStatus(status));
    }
}
