package ai.jarvis.mesh.protocol

import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Wire-compatible crypto primitives for the Python JARVIS Mesh core.
 * Requires an Android/JCA provider with Ed25519 and X25519 (targeted at modern Android).
 */
object CryptoCore {
    private val ED25519_X509_PREFIX = hex("302a300506032b6570032100")
    private val ED25519_PKCS8_PREFIX = hex("302e020100300506032b657004220420")
    private val X25519_X509_PREFIX = hex("302a300506032b656e032100")
    private val X25519_PKCS8_PREFIX = hex("302e020100300506032b656e04220420")
    private val INFO = "jarvis-mesh-e2e-v1".toByteArray(StandardCharsets.UTF_8)

    fun decodeB64(text: String): ByteArray = Base64.getUrlDecoder().decode(pad(text))
    fun encodeB64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun verifyEd25519Raw(publicRaw: ByteArray, payload: ByteArray, signatureRaw: ByteArray): Boolean {
        val key = KeyFactory.getInstance("Ed25519")
            .generatePublic(X509EncodedKeySpec(ED25519_X509_PREFIX + publicRaw))
        val verifier = Signature.getInstance("Ed25519")
        verifier.initVerify(key)
        verifier.update(payload)
        return verifier.verify(signatureRaw)
    }

    fun signEd25519Raw(privateRaw: ByteArray, payload: ByteArray): ByteArray {
        val key = KeyFactory.getInstance("Ed25519")
            .generatePrivate(PKCS8EncodedKeySpec(ED25519_PKCS8_PREFIX + privateRaw))
        val signer = Signature.getInstance("Ed25519")
        signer.initSign(key)
        signer.update(payload)
        return signer.sign()
    }

    fun x25519(privateRaw: ByteArray, publicRaw: ByteArray): ByteArray {
        val privateKey = KeyFactory.getInstance("X25519")
            .generatePrivate(PKCS8EncodedKeySpec(X25519_PKCS8_PREFIX + privateRaw))
        val publicKey = KeyFactory.getInstance("X25519")
            .generatePublic(X509EncodedKeySpec(X25519_X509_PREFIX + publicRaw))
        val ka = KeyAgreement.getInstance("X25519")
        ka.init(privateKey)
        ka.doPhase(publicKey, true)
        return ka.generateSecret()
    }

    fun derivePacketKey(sharedSecret: ByteArray, sender: String, target: String): ByteArray {
        val context = "$sender|$target".toByteArray(StandardCharsets.UTF_8)
        val info = INFO + "|".toByteArray(StandardCharsets.UTF_8) + context
        return hkdfSha256(sharedSecret, info, 32)
    }

    data class SealedPacket(
        val ephemeralPublicRaw: ByteArray,
        val nonce: ByteArray,
        val ciphertext: ByteArray,
    )

    fun encryptPacket(
        targetPublicRaw: ByteArray,
        sender: String,
        target: String,
        plaintext: ByteArray,
    ): SealedPacket {
        val pair = KeyPairGenerator.getInstance("X25519").generateKeyPair()
        val privateRaw = pair.private.encoded.takeLast(32).toByteArray()
        val publicRaw = pair.public.encoded.takeLast(32).toByteArray()
        val shared = x25519(privateRaw, targetPublicRaw)
        val key = derivePacketKey(shared, sender, target)
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD("$sender|$target".toByteArray(StandardCharsets.UTF_8))
        val ciphertext = cipher.doFinal(plaintext)
        return SealedPacket(publicRaw, nonce, ciphertext)
    }

    fun decryptPacket(
        targetPrivateRaw: ByteArray,
        sender: String,
        target: String,
        ephemeralPublicRaw: ByteArray,
        nonce: ByteArray,
        ciphertext: ByteArray,
    ): ByteArray {
        val shared = x25519(targetPrivateRaw, ephemeralPublicRaw)
        val key = derivePacketKey(shared, sender, target)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD("$sender|$target".toByteArray(StandardCharsets.UTF_8))
        return cipher.doFinal(ciphertext)
    }

    fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun hkdfSha256(ikm: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        val zeroSalt = ByteArray(32)
        mac.init(SecretKeySpec(zeroSalt, "HmacSHA256"))
        val prk = mac.doFinal(ikm)

        val out = ByteArray(length)
        var previous = ByteArray(0)
        var written = 0
        var counter = 1
        while (written < length) {
            mac.init(SecretKeySpec(prk, "HmacSHA256"))
            mac.update(previous)
            mac.update(info)
            mac.update(counter.toByte())
            previous = mac.doFinal()
            val take = minOf(previous.size, length - written)
            System.arraycopy(previous, 0, out, written, take)
            written += take
            counter++
        }
        return out
    }

    private fun pad(text: String): String = text + "=".repeat((4 - text.length % 4) % 4)
    private fun hex(s: String): ByteArray = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
