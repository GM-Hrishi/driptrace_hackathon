package com.ivfluidwatch.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/**
 * Live view of beds/ for MonitorService, over Firebase's REST streaming API.
 *
 *   1. Anonymous sign-in (Identity Toolkit accounts:signUp), the same
 *      `auth != null` identity the website and the in-app WebView use. The
 *      refresh token is kept, so a restart does not create a new user.
 *   2. GET <databaseURL>/<bedsPath>.json?auth=<idToken> with
 *      Accept: text/event-stream. Firebase sends one `put` with the whole tree,
 *      then a `put`/`patch` for every change, and `keep-alive` every ~30 s.
 *
 * Plain HttpURLConnection on purpose: no Firebase Android SDK, no
 * google-services.json, and the exact protocol can be checked from a desktop.
 * Only the public web identifiers are used; never the firmware's secret.
 */
final class FirebaseStream {

    private static final String TAG = "DripTraceStream";
    private static final String REFRESH_KEY = "driptrace.native.refreshToken";

    interface Listener {
        /** The tree changed. `tree` is a private copy of beds/. Called on the stream thread. */
        void onTree(JSONObject tree);

        void onConnection(boolean connected, String error);
    }

    static final class Config {
        String apiKey = "";
        String databaseURL = "";
        String bedsPath = "beds";

        boolean usable() {
            return !apiKey.isEmpty() && !databaseURL.isEmpty();
        }

        /** Written by the mobile Vite build (vite.mobile.config.js). */
        static Config load(Context context) {
            Config c = new Config();
            try (InputStream in = context.getAssets().open("web/firebase-config.json")) {
                JSONObject j = new JSONObject(readAll(in));
                c.apiKey = j.optString("apiKey", "");
                c.databaseURL = j.optString("databaseURL", "").replaceAll("/+$", "");
                c.bedsPath = j.optString("bedsPath", "beds");
            } catch (IOException | JSONException e) {
                Log.w(TAG, "No firebase-config.json in assets; run npm run build:app");
            }
            return c;
        }
    }

    private final Config config;
    private final SharedPreferences prefs;
    private final Listener listener;
    private volatile boolean running;
    private volatile HttpURLConnection current;
    private Thread thread;

    private String idToken;
    private long idTokenExpiresAt;
    private JSONObject tree = new JSONObject();

    FirebaseStream(Context context, Config config, Listener listener) {
        this.config = config;
        this.listener = listener;
        this.prefs = context.getApplicationContext().getSharedPreferences(WardStore.PREFS, Context.MODE_PRIVATE);
    }

    void start() {
        if (running) return;
        running = true;
        thread = new Thread(this::loop, "driptrace-stream");
        thread.setDaemon(true);
        thread.start();
    }

    void stop() {
        running = false;
        HttpURLConnection c = current;
        if (c != null) c.disconnect();
        if (thread != null) thread.interrupt();
    }

    // --- Auth -----------------------------------------------------------------

    private String token() throws IOException {
        long now = System.currentTimeMillis();
        if (idToken != null && now < idTokenExpiresAt - 120_000) return idToken;
        String refresh = prefs.getString(REFRESH_KEY, "");
        try {
            if (!refresh.isEmpty()) {
                try {
                    JSONObject r = post(
                            "https://securetoken.googleapis.com/v1/token?key=" + enc(config.apiKey),
                            "grant_type=refresh_token&refresh_token=" + enc(refresh),
                            "application/x-www-form-urlencoded");
                    accept(r.getString("id_token"), r.optString("refresh_token", refresh),
                            Long.parseLong(r.optString("expires_in", "3600")));
                    return idToken;
                } catch (HttpError e) {
                    // Refresh token revoked or the user was deleted: sign in afresh below.
                    if (e.code != 400 && e.code != 401 && e.code != 403) throw e;
                }
            }
            JSONObject r = post(
                    "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + enc(config.apiKey),
                    "{\"returnSecureToken\":true}",
                    "application/json");
            accept(r.getString("idToken"), r.getString("refreshToken"),
                    Long.parseLong(r.optString("expiresIn", "3600")));
            return idToken;
        } catch (JSONException | NumberFormatException e) {
            throw new IOException("Unexpected auth response", e);
        }
    }

    private void accept(String id, String refresh, long expiresInSeconds) {
        idToken = id;
        idTokenExpiresAt = System.currentTimeMillis() + expiresInSeconds * 1000;
        prefs.edit().putString(REFRESH_KEY, refresh).apply();
    }

    // --- Stream ---------------------------------------------------------------

    private void loop() {
        long backoff = 1_000;
        while (running) {
            try {
                stream();
                backoff = 1_000;
            } catch (HttpError e) {
                Log.w(TAG, "Stream HTTP " + e.code);
                if (e.code == 401) idToken = null;
                listener.onConnection(false, e.code == 401 ? "Not permitted to read bed data" : "Cloud error " + e.code);
            } catch (IOException e) {
                Log.w(TAG, "Stream dropped: " + e.getMessage());
                listener.onConnection(false, "Cloud connection lost");
            }
            if (!running) break;
            try {
                Thread.sleep(backoff);
            } catch (InterruptedException ignored) {
                // stop() interrupts the wait.
            }
            backoff = Math.min(backoff * 2, 30_000);
        }
    }

    private void stream() throws IOException {
        String token = token();
        URL url = new URL(config.databaseURL + "/" + config.bedsPath + ".json?auth=" + enc(token));
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        current = c;
        try {
            c.setRequestProperty("Accept", "text/event-stream");
            c.setConnectTimeout(15_000);
            // keep-alive arrives every ~30 s; silence for longer means the socket is dead.
            c.setReadTimeout(75_000);
            int code = c.getResponseCode();
            if (code != 200) throw new HttpError(code);

            BufferedReader reader = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
            String event = null;
            StringBuilder data = new StringBuilder();
            String line;
            while (running && (line = reader.readLine()) != null) {
                if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    data.append(line.substring(5).trim());
                } else if (line.isEmpty()) {
                    if (event != null && !dispatch(event, data.toString())) return;
                    event = null;
                    data.setLength(0);
                }
                // Reconnect with a fresh token shortly before the current one expires.
                if (System.currentTimeMillis() > idTokenExpiresAt - 60_000) return;
            }
        } finally {
            current = null;
            c.disconnect();
        }
    }

    /** @return false to drop the connection and reconnect. */
    private boolean dispatch(String event, String data) {
        switch (event) {
            case "put":
            case "patch":
                try {
                    JSONObject msg = new JSONObject(data);
                    String path = msg.optString("path", "/");
                    Object value = msg.opt("data");
                    if ("put".equals(event)) {
                        set(path, value);
                    } else if (value instanceof JSONObject) {
                        JSONObject children = (JSONObject) value;
                        for (Iterator<String> it = children.keys(); it.hasNext(); ) {
                            String key = it.next();
                            set(join(path, key), children.opt(key));
                        }
                    }
                    listener.onConnection(true, null);
                    listener.onTree(new JSONObject(tree.toString()));
                } catch (JSONException e) {
                    Log.w(TAG, "Bad stream message", e);
                }
                return true;
            case "keep-alive":
                return true;
            case "auth_revoked":
                idToken = null;
                return false;
            case "cancel":
                listener.onConnection(false, "Not permitted to read bed data");
                return false;
            default:
                return true;
        }
    }

    /** Replace (or delete, for null) the value at a stream path inside the tree. */
    private void set(String path, Object value) throws JSONException {
        String trimmed = path.replaceAll("^/+|/+$", "");
        boolean isNull = value == null || value == JSONObject.NULL;
        if (trimmed.isEmpty()) {
            tree = value instanceof JSONObject ? (JSONObject) value : new JSONObject();
            return;
        }
        String[] parts = trimmed.split("/");
        JSONObject node = tree;
        for (int i = 0; i < parts.length - 1; i++) {
            JSONObject next = node.optJSONObject(parts[i]);
            if (next == null) {
                if (isNull) return;
                next = new JSONObject();
                node.put(parts[i], next);
            }
            node = next;
        }
        String leaf = parts[parts.length - 1];
        if (isNull) node.remove(leaf);
        else node.put(leaf, value);
    }

    private static String join(String path, String key) {
        return path.endsWith("/") ? path + key : path + "/" + key;
    }

    // --- HTTP helpers -----------------------------------------------------------

    static final class HttpError extends IOException {
        final int code;

        HttpError(int code) {
            super("HTTP " + code);
            this.code = code;
        }
    }

    private static JSONObject post(String url, String body, String contentType) throws IOException, JSONException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", contentType);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code != 200) throw new HttpError(code);
            try (InputStream in = c.getInputStream()) {
                return (JSONObject) new JSONTokener(readAll(in)).nextValue();
            }
        } finally {
            c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
        return buf.toString("UTF-8");
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }
}
