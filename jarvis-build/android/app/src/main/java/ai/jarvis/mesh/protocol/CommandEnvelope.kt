package ai.jarvis.mesh.protocol

/**
 * Android-side wire contract. Execution is intentionally separate: Android permissions
 * must be checked before any command handler is invoked.
 */
data class CommandEnvelope(
    val command_id: String,
    val issuer: String,
    val target: String,
    val capability: String,
    val params: Map<String, Any?>,
    val issued_at: Long,
    val expires_at: Long,
    val nonce: String,
    val signature: String,
)

object Capabilities {
    val safe = setOf(
        "device.status",
        "mesh.result",
        "device.ring",
        "device.location.request",
        "media.play",
        "media.pause",
        "media.next",
        "media.previous",
        "media.volume.set",
        "app.open",
        "notification.list",
        "clipboard.push",
        "file.offer",
    )

    val hardDeny = setOf(
        "device.unlock",
        "screen_lock.bypass",
        "biometric.bypass",
        "credential.read",
        "credential.export",
        "security.disable",
    )
}
