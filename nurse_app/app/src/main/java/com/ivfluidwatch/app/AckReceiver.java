package com.ivfluidwatch.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * "Acknowledge" on an alarm notification. Same meaning as the in-app button:
 * the bed's current top alert stops sounding until it changes or clears.
 */
public class AckReceiver extends BroadcastReceiver {

    static final String EXTRA_BED_ID = "bedId";
    static final String EXTRA_BED_LABEL = "bedLabel";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_SEVERITY = "severity";
    static final String EXTRA_REASON = "reason";

    @Override
    public void onReceive(Context context, Intent intent) {
        String bedId = intent.getStringExtra(EXTRA_BED_ID);
        String kind = intent.getStringExtra(EXTRA_KIND);
        if (bedId == null || kind == null) return;

        WardStore.queueAck(context, bedId,
                orEmpty(intent.getStringExtra(EXTRA_BED_LABEL)), kind,
                orEmpty(intent.getStringExtra(EXTRA_SEVERITY)),
                orEmpty(intent.getStringExtra(EXTRA_REASON)));

        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(MonitorService.bedNotificationId(bedId));
        MonitorService.poke();
        MainActivity.notifyStoreChanged();
    }

    private static String orEmpty(String s) {
        return s != null ? s : "";
    }
}
