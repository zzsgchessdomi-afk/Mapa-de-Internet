package ai.jarvis.mesh.app

import android.content.Context
import org.json.JSONObject

class MeshConfig(context: Context) {
    private val prefs = context.getSharedPreferences("jarvis_mesh_config", Context.MODE_PRIVATE)

    var relayUrl: String
        get() = prefs.getString("relay_url", "")!!
        set(value) { prefs.edit().putString("relay_url", value.trim()).apply() }

    var assistantId: String?
        get() = prefs.getString("assistant_id", null)
        set(value) { prefs.edit().putString("assistant_id", value).apply() }

    var assistantName: String
        get() = prefs.getString("assistant_name", "JARVIS")!!
        set(value) { prefs.edit().putString("assistant_name", value).apply() }

    fun peer(): TrustedPeer? {
        val raw = prefs.getString("peer", null) ?: return null
        val o = JSONObject(raw)
        return TrustedPeer(
            o.getString("device_id"), o.getString("label"),
            o.getString("signing_public_key_b64"), o.getString("encryption_public_key_b64")
        )
    }

    fun savePeer(peer: TrustedPeer) {
        val o = JSONObject()
            .put("device_id", peer.deviceId)
            .put("label", peer.label)
            .put("signing_public_key_b64", peer.signingPublicKeyB64)
            .put("encryption_public_key_b64", peer.encryptionPublicKeyB64)
        prefs.edit().putString("peer", o.toString()).apply()
    }
}
