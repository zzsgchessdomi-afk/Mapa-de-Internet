package ai.jarvis.mesh.app

import ai.jarvis.mesh.protocol.CryptoCore
import ai.jarvis.mesh.runtime.AndroidDeviceExecutor
import ai.jarvis.mesh.runtime.CommandPolicy
import ai.jarvis.mesh.runtime.CommandRouter
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Collections

class CommandProcessor(
    private val context: android.content.Context,
    private val identity: LocalIdentity,
    private val peer: TrustedPeer,
) {
    private val router = CommandRouter(CommandPolicy(), AndroidDeviceExecutor(context))
    private val audit = AndroidAuditLog(context)
    private val seenNonces = Collections.synchronizedSet(mutableSetOf<String>())

    /** Returns an encrypted response packet for the peer, or null if the packet is unroutable. */
    fun process(packetRaw: String): String? {
        val packet = JSONObject(packetRaw)
        val sender = packet.getString("sender")
        val target = packet.getString("target")
        if (sender != peer.deviceId || target != identity.deviceId) return null

        val plain = CryptoCore.decryptPacket(
            identity.encryptionPrivateRaw,
            sender,
            target,
            CryptoCore.decodeB64(packet.getString("ephemeral_public_key")),
            CryptoCore.decodeB64(packet.getString("nonce")),
            CryptoCore.decodeB64(packet.getString("ciphertext")),
        )
        val command = JSONObject(String(plain, StandardCharsets.UTF_8))
        val commandId = command.getString("command_id")
        val capability = command.getString("capability")

        val validationError = validate(command, sender, target)
        val resultData: Map<String, Any?>
        val ok: Boolean
        val error: String?
        if (validationError != null) {
            audit.append(commandId, capability, "denied", validationError)
            ok = false
            error = validationError
            resultData = emptyMap()
        } else {
            val params = JsonCodec.jsonToValue(command.getJSONObject("params")) as Map<String, Any?>
            val result = router.dispatch(capability, params)
            ok = result.ok
            error = result.error
            resultData = result.data
            audit.append(commandId, capability, if (ok) "executed" else "denied", error)
        }

        val response = JsonCodec.signedCommandJson(
            identity,
            peer.deviceId,
            "mesh.result",
            mapOf(
                "request_command_id" to commandId,
                "request_capability" to capability,
                "ok" to ok,
                "data" to resultData,
                "error" to error,
            ),
        )
        return JsonCodec.sealCommand(identity, peer, response)
    }

    private fun validate(command: JSONObject, sender: String, target: String): String? {
        return try {
            if (command.getString("issuer") != sender) return "Issuer mismatch"
            if (command.getString("target") != target) return "Target mismatch"
            val now = System.currentTimeMillis() / 1000
            val issued = command.getLong("issued_at")
            val expires = command.getLong("expires_at")
            if (expires < now) return "Command expired"
            if (issued > now + 60) return "Command timestamp too far in the future"
            val nonce = command.getString("nonce")
            if (!seenNonces.add(nonce)) return "Replay detected"
            if (seenNonces.size > 4096) seenNonces.clear()

            val params = JsonCodec.jsonToValue(command.getJSONObject("params"))
            val unsigned = linkedMapOf<String, Any?>(
                "command_id" to command.getString("command_id"),
                "issuer" to command.getString("issuer"),
                "target" to command.getString("target"),
                "capability" to command.getString("capability"),
                "params" to params,
                "issued_at" to issued,
                "expires_at" to expires,
                "nonce" to nonce,
            )
            val verified = CryptoCore.verifyEd25519Raw(
                CryptoCore.decodeB64(peer.signingPublicKeyB64),
                JsonCodec.canonical(unsigned).toByteArray(StandardCharsets.UTF_8),
                CryptoCore.decodeB64(command.getString("signature")),
            )
            if (!verified) "Signature invalid" else null
        } catch (e: Exception) {
            e.message ?: e::class.java.simpleName
        }
    }
}
