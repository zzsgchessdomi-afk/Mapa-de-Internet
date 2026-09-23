package ai.jarvis.mesh.app

import ai.jarvis.mesh.protocol.CryptoCore
import ai.jarvis.mesh.runtime.AndroidDeviceExecutor
import ai.jarvis.mesh.runtime.CommandPolicy
import ai.jarvis.mesh.runtime.CommandRouter
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Collections

data class VerifiedPeerCommand(
    val commandId: String,
    val capability: String,
    val params: Map<String, Any?>,
)

class CommandProcessor(
    private val context: android.content.Context,
    private val identity: LocalIdentity,
    private val peer: TrustedPeer,
) {
    private val router = CommandRouter(CommandPolicy(), AndroidDeviceExecutor(context))
    private val audit = AndroidAuditLog(context)
    private val seenNonces = Collections.synchronizedSet(mutableSetOf<String>())

    /**
     * Decrypts and verifies one peer packet exactly once.
     * The nonce is committed only after signature verification succeeds.
     */
    fun decode(packetRaw: String): VerifiedPeerCommand? {
        val packet = JSONObject(packetRaw)
        val sender = packet.optString("sender")
        val target = packet.optString("target")
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
        if (validationError != null) {
            audit.append(commandId, capability, "denied", validationError)
            return null
        }
        @Suppress("UNCHECKED_CAST")
        val params = JsonCodec.jsonToValue(command.getJSONObject("params")) as Map<String, Any?>
        return VerifiedPeerCommand(commandId, capability, params)
    }

    fun executeAndRespond(command: VerifiedPeerCommand): String {
        val result = router.dispatch(command.capability, command.params)
        audit.append(
            command.commandId,
            command.capability,
            if (result.ok) "executed" else "denied",
            result.error,
        )
        val response = JsonCodec.signedCommandJson(
            identity,
            peer.deviceId,
            "mesh.result",
            mapOf(
                "request_command_id" to command.commandId,
                "request_capability" to command.capability,
                "ok" to result.ok,
                "data" to result.data,
                "error" to result.error,
            ),
        )
        return JsonCodec.sealCommand(identity, peer, response)
    }

    /** Compatibility entry point for ordinary PC -> Android commands. */
    fun process(packetRaw: String): String? {
        val command = decode(packetRaw) ?: return null
        if (command.capability == "mesh.result") return null
        return executeAndRespond(command)
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
            if (seenNonces.contains(nonce)) return "Replay detected"

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
            if (!verified) return "Signature invalid"
            if (!seenNonces.add(nonce)) return "Replay detected"
            if (seenNonces.size > 4096) seenNonces.clear()
            null
        } catch (e: Exception) {
            e.message ?: e::class.java.simpleName
        }
    }
}
