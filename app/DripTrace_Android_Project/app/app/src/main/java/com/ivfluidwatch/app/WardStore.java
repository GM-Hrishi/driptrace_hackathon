package com.ivfluidwatch.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native access to the ward the nurse app keeps in SharedPreferences.
 *
 * The web app owns STORE_KEY (mobile/src/lib/mobileStore.js) and is the only
 * writer of it. Native code never rewrites that JSON, so the two sides cannot
 * overwrite each other's changes. When native code has something to add (an
 * Acknowledge tapped on a notification), it goes into INBOX_KEY, which the web
 * app drains into its own store through takeInbox().
 */
final class WardStore {

    static final String PREFS = "DripTracePrefs";
    /** Must match STORAGE_KEY in mobile/src/lib/mobileStore.js. */
    static final String STORE_KEY = "driptrace.app.v1";
    static final String INBOX_KEY = "driptrace.native.inbox";

    private WardStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The web app's ward, or an empty object if nothing is stored yet. */
    static JSONObject readStore(Context context) {
        try {
            String raw = prefs(context).getString(STORE_KEY, "");
            return raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static JSONObject readInbox(SharedPreferences p) {
        JSONObject inbox;
        try {
            String raw = p.getString(INBOX_KEY, "");
            inbox = raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
        } catch (JSONException e) {
            inbox = new JSONObject();
        }
        try {
            if (inbox.optJSONObject("acks") == null) inbox.put("acks", new JSONObject());
            if (inbox.optJSONArray("log") == null) inbox.put("log", new JSONArray());
        } catch (JSONException ignored) {
            // put() only throws for non-finite numbers.
        }
        return inbox;
    }

    /** Acks the web app has not picked up yet, keyed by bed id. */
    static synchronized JSONObject pendingAcks(Context context) {
        JSONObject acks = readInbox(prefs(context)).optJSONObject("acks");
        return acks != null ? acks : new JSONObject();
    }

    /** Queue an acknowledgement made from a notification. */
    static synchronized void queueAck(Context context, String bedId, String bedLabel, String kind,
                                      String severity, String reason) {
        SharedPreferences p = prefs(context);
        JSONObject inbox = readInbox(p);
        long at = System.currentTimeMillis();
        try {
            inbox.getJSONObject("acks").put(bedId, new JSONObject().put("kind", kind).put("at", at));
            inbox.getJSONArray("log").put(new JSONObject()
                    .put("id", "n-" + Long.toString(at, 36) + "-" + Integer.toString(bedId.hashCode() & 0xfff, 36))
                    .put("at", at)
                    .put("bedId", bedId)
                    .put("bedLabel", bedLabel)
                    .put("kind", kind)
                    .put("severity", severity)
                    .put("event", "acknowledged")
                    .put("reason", reason + " (from notification)"));
        } catch (JSONException ignored) {
            return;
        }
        p.edit().putString(INBOX_KEY, inbox.toString()).commit();
    }

    /** Hand the queued items to the web app and clear the queue, atomically. */
    static synchronized String takeInbox(Context context) {
        SharedPreferences p = prefs(context);
        String raw = p.getString(INBOX_KEY, "");
        if (!raw.isEmpty()) p.edit().remove(INBOX_KEY).commit();
        return raw;
    }
}
