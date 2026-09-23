package ai.jarvis.mesh.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import ai.jarvis.mesh.protocol.CryptoCore
import java.security.KeyPairGenerator
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class IdentityStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("jarvis_identity", Context.MODE_PRIVATE)
    private val alias = "jarvis_mesh_identity_wrap_v1"

    fun getOrCreate(): LocalIdentity {
        val existing = prefs.getString("blob", null)
        if (existing != null) return decode(existing)

        val signing = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val encryption = KeyPairGenerator.getInstance("X25519").generateKeyPair()
        val signPriv = signing.private.encoded.takeLast(32).toByteArray()
        val signPub = signing.public.encoded.takeLast(32).toByteArray()
        val encPriv = encryption.private.encoded.takeLast(32).toByteArray()
        val encPub = encryption.public.encoded.takeLast(32).toByteArray()

        val probe = "jarvis-key-self-test".toByteArray()
        val sig = CryptoCore.signEd25519Raw(signPriv, probe)
        check(CryptoCore.verifyEd25519Raw(signPub, probe, sig)) { "Ed25519 raw-key self-test failed" }
        val peerProbe = KeyPairGenerator.getInstance("X25519").generateKeyPair()
        val peerPriv = peerProbe.private.encoded.takeLast(32).toByteArray()
        val peerPub = peerProbe.public.encoded.takeLast(32).toByteArray()
        check(CryptoCore.x25519(encPriv, peerPub).contentEquals(CryptoCore.x25519(peerPriv, encPub))) {
            "X25519 raw-key self-test failed"
        }

        val digest = CryptoCore.sha256(signPub).joinToString("") { "%02x".format(it) }.take(20)
        val identity = LocalIdentity("android-$digest", signPriv, signPub, encPriv, encPub)
        prefs.edit().putString("blob", encode(identity)).apply()
        return identity
    }

    private fun encode(id: LocalIdentity): String {
        val plain = listOf(
            id.deviceId,
            CryptoCore.encodeB64(id.signingPrivateRaw),
            CryptoCore.encodeB64(id.signingPublicRaw),
            CryptoCore.encodeB64(id.encryptionPrivateRaw),
            CryptoCore.encodeB64(id.encryptionPublicRaw),
        ).joinToString("\n").toByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
        val encrypted = cipher.doFinal(plain)
        return CryptoCore.encodeB64(cipher.iv) + "." + CryptoCore.encodeB64(encrypted)
    }

    private fun decode(blob: String): LocalIdentity {
        val (ivText, cipherText) = blob.split('.', limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, CryptoCore.decodeB64(ivText)))
        val parts = String(cipher.doFinal(CryptoCore.decodeB64(cipherText))).split('\n')
        check(parts.size == 5) { "Malformed local identity" }
        return LocalIdentity(
            parts[0],
            CryptoCore.decodeB64(parts[1]),
            CryptoCore.decodeB64(parts[2]),
            CryptoCore.decodeB64(parts[3]),
            CryptoCore.decodeB64(parts[4]),
        )
    }

    private fun wrappingKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
