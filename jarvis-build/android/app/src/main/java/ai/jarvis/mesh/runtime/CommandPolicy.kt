package ai.jarvis.mesh.runtime

import ai.jarvis.mesh.protocol.Capabilities

class PolicyDenied(message: String) : SecurityException(message)

class CommandPolicy(
    private val allowed: Set<String> = Capabilities.safe,
) {
    fun authorize(capability: String) {
        if (capability in Capabilities.hardDeny) {
            throw PolicyDenied("Capability is permanently denied: $capability")
        }
        if (capability !in allowed) {
            throw PolicyDenied("Capability not granted on this device: $capability")
        }
    }
}
