package ai.jarvis.mesh.app

import android.content.Context
import org.json.JSONObject

class AndroidAuditLog(private val context: Context) {
    @Synchronized
    fun append(commandId: String, capability: String, decision: String, detail: String? = null) {
        val o = JSONObject()
            .put("ts", System.currentTimeMillis())
            .put("command_id", commandId)
            .put("capability", capability)
            .put("decision", decision)
        if (detail != null) o.put("detail", detail)
        context.openFileOutput("jarvis-audit.jsonl", Context.MODE_APPEND).bufferedWriter().use {
            it.append(o.toString()).append('\n')
        }
    }
}
