package ai.jarvis.mesh.app

data class LocalIdentity(
    val deviceId: String,
    val signingPrivateRaw: ByteArray,
    val signingPublicRaw: ByteArray,
    val encryptionPrivateRaw: ByteArray,
    val encryptionPublicRaw: ByteArray,
)

data class TrustedPeer(
    val deviceId: String,
    val label: String,
    val signingPublicKeyB64: String,
    val encryptionPublicKeyB64: String,
)
