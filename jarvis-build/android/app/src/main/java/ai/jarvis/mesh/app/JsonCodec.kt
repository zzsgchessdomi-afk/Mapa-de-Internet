package ai.jarvis.mesh.app

import ai.jarvis.mesh.protocol.CryptoCore
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.UUID

object JsonCodec {
    fun jsonToValue(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { jsonToValue(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { jsonToValue(value.get(it)) }
        else -> value
    }

    fun canonical(value: Any?): String = when (value) {
        null -> "null"
        is Boolean -> if (value) "true" else "false"
        is String -> JSONObject.quote(value)
        is Byte, is Short, is Int, is Long -> value.toString()
        is Float, is Double -> {
            val d = (value as Number).toDouble()
            require(d.isFinite()) { "Non-finite JSON number" }
            JSONObject.numberToString(value as Number)
        }
        is Map<*, *> -> value.entries.sortedBy { it.key.toString() }.joinToString(",", "{", "}") {
            JSONObject.quote(it.key.toString()) + ":" + canonical(it.value)
        }
        is Iterable<*> -> value.joinToString(",", "[", "]") { canonical(it) }
        is Array<*> -> value.asIterable().joinToString(",", "[", "]") { canonical(it) }
        else -> error("Unsupported JSON type: ${value::class.java.name}")
    }

    fun registrationJson(identity: LocalIdentity, now: Long = System.currentTimeMillis() / 1000): String {
        val nonceBytes = ByteArray(18).also { SecureRandom().nextBytes(it) }
        val unsigned = linkedMapOf<String, Any?>(
            "type" to "register",
            "device_id" to identity.deviceId,
            "signing_public_key_b64" to CryptoCore.encodeB64(identity.signingPublicRaw),
            "issued_at" to now,
            "nonce" to CryptoCore.encodeB64(nonceBytes),
        )
        val sig = CryptoCore.signEd25519Raw(
            identity.signingPrivateRaw,
            canonical(unsigned).toByteArray(StandardCharsets.UTF_8),
        )
        return canonical(unsigned + ("signature" to CryptoCore.encodeB64(sig)))
    }

    fun signedCommandJson(
        identity: LocalIdentity,
        target: String,
        capability: String,
        params: Map<String, Any?>,
        ttlSeconds: Long = 30,
        now: Long = System.currentTimeMillis() / 1000,
    ): String {
        val nonceBytes = ByteArray(18).also { SecureRandom().nextBytes(it) }
        val unsigned = linkedMapOf<String, Any?>(
            "command_id" to UUID.randomUUID().toString(),
            "issuer" to identity.deviceId,
            "target" to target,
            "capability" to capability,
            "params" to params,
            "issued_at" to now,
            "expires_at" to now + ttlSeconds,
            "nonce" to CryptoCore.encodeB64(nonceBytes),
        )
        val signing = canonical(unsigned).toByteArray(StandardCharsets.UTF_8)
        val sig = CryptoCore.signEd25519Raw(identity.signingPrivateRaw, signing)
        return canonical(unsigned + ("signature" to CryptoCore.encodeB64(sig)))
    }

    fun sealCommand(identity: LocalIdentity, peer: TrustedPeer, commandJson: String): String {
        val sealed = CryptoCore.encryptPacket(
            CryptoCore.decodeB64(peer.encryptionPublicKeyB64),
            identity.deviceId,
            peer.deviceId,
            commandJson.toByteArray(StandardCharsets.UTF_8),
        )
        return canonical(mapOf(
            "sender" to identity.deviceId,
            "target" to peer.deviceId,
            "ephemeral_public_key" to CryptoCore.encodeB64(sealed.ephemeralPublicRaw),
            "nonce" to CryptoCore.encodeB64(sealed.nonce),
            "ciphertext" to CryptoCore.encodeB64(sealed.ciphertext),
        ))
    }
}
