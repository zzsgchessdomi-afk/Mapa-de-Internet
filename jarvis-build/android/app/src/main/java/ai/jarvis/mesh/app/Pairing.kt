package ai.jarvis.mesh.app

import ai.jarvis.mesh.protocol.CryptoCore
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom

object Pairing {
    fun createOffer(identity: LocalIdentity, label: String = "Android", ttlSeconds: Long = 300): String {
        val now = System.currentTimeMillis() / 1000
        val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val unsigned = linkedMapOf<String, Any?>(
            "device_id" to identity.deviceId,
            "label" to label,
            "signing_public_key_b64" to CryptoCore.encodeB64(identity.signingPublicRaw),
            "encryption_public_key_b64" to CryptoCore.encodeB64(identity.encryptionPublicRaw),
            "issued_at" to now,
            "expires_at" to now + ttlSeconds,
            "nonce" to CryptoCore.encodeB64(nonce),
        )
        val sig = CryptoCore.signEd25519Raw(
            identity.signingPrivateRaw,
            JsonCodec.canonical(unsigned).toByteArray(StandardCharsets.UTF_8),
        )
        return JsonCodec.canonical(unsigned + ("signature" to CryptoCore.encodeB64(sig)))
    }

    fun verifyAndParse(raw: String): TrustedPeer {
        val o = JSONObject(raw)
        val keys = listOf("device_id", "label", "signing_public_key_b64", "encryption_public_key_b64", "issued_at", "expires_at", "nonce", "signature")
        require(keys.all { o.has(it) }) { "Malformed pairing offer" }
        val now = System.currentTimeMillis() / 1000
        require(o.getLong("expires_at") >= now) { "Pairing offer expired" }
        val unsigned = linkedMapOf<String, Any?>(
            "device_id" to o.getString("device_id"),
            "label" to o.getString("label"),
            "signing_public_key_b64" to o.getString("signing_public_key_b64"),
            "encryption_public_key_b64" to o.getString("encryption_public_key_b64"),
            "issued_at" to o.getLong("issued_at"),
            "expires_at" to o.getLong("expires_at"),
            "nonce" to o.getString("nonce"),
        )
        val signingPub = CryptoCore.decodeB64(o.getString("signing_public_key_b64"))
        val ok = CryptoCore.verifyEd25519Raw(
            signingPub,
            JsonCodec.canonical(unsigned).toByteArray(StandardCharsets.UTF_8),
            CryptoCore.decodeB64(o.getString("signature")),
        )
        require(ok) { "Pairing signature invalid" }
        val digest = CryptoCore.sha256(signingPub).joinToString("") { "%02x".format(it) }.take(20)
        require(o.getString("device_id").endsWith("-$digest")) { "Device id does not match signing key" }
        return TrustedPeer(
            o.getString("device_id"), o.getString("label"),
            o.getString("signing_public_key_b64"), o.getString("encryption_public_key_b64"),
        )
    }

    fun comparisonCode(signingB64: String, encryptionB64: String): String {
        val digest = CryptoCore.sha256(CryptoCore.decodeB64(signingB64) + CryptoCore.decodeB64(encryptionB64))
        val value = ByteBuffer.wrap(digest.copyOfRange(0, 4)).order(ByteOrder.BIG_ENDIAN).int.toLong() and 0xffffffffL
        return "%06d".format(value % 1_000_000)
    }
}
