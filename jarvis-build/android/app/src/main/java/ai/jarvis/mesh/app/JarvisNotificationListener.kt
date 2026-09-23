package ai.jarvis.mesh.app

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Notification access exists only after the owner explicitly enables Android's
 * Notification Access for JARVIS. We cache a small bounded, local-only snapshot.
 */
class JarvisNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val extras = sbn.notification.extras
        val item = JSONObject()
            .put("package", sbn.packageName)
            .put("posted_at_ms", sbn.postTime)
            .put("title", extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
            .put("text", extras.getCharSequence(Notification.EXTRA_TEXT)?.toString())
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrElse { JSONArray() }
        val next = JSONArray().put(item)
        val start = (arr.length() - 49).coerceAtLeast(0)
        for (i in start until arr.length()) next.put(arr.get(i))
        prefs.edit().putString(KEY, next.toString()).apply()
    }

    companion object {
        private const val PREFS = "jarvis_notifications"
        private const val KEY = "recent"

        fun snapshot(context: Context, limit: Int): List<Map<String, Any?>> {
            val bounded = limit.coerceIn(1, 50)
            val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"
            val arr = runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
            val start = (arr.length() - bounded).coerceAtLeast(0)
            val out = mutableListOf<Map<String, Any?>>()
            for (i in start until arr.length()) {
                val o = arr.getJSONObject(i)
                out += mapOf(
                    "package" to o.optString("package"),
                    "posted_at_ms" to o.optLong("posted_at_ms"),
                    "title" to o.opt("title").takeUnless { it == JSONObject.NULL },
                    "text" to o.opt("text").takeUnless { it == JSONObject.NULL },
                )
            }
            return out.reversed()
        }
    }
}
