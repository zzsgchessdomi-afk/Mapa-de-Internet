package ai.jarvis.mesh.runtime

data class ExecutionResult(
    val ok: Boolean,
    val data: Map<String, Any?> = emptyMap(),
    val error: String? = null,
)

fun interface CapabilityExecutor {
    fun execute(capability: String, params: Map<String, Any?>): ExecutionResult
}

class CommandRouter(
    private val policy: CommandPolicy,
    private val executor: CapabilityExecutor,
) {
    fun dispatch(capability: String, params: Map<String, Any?>): ExecutionResult {
        return try {
            policy.authorize(capability)
            executor.execute(capability, params)
        } catch (exc: Exception) {
            ExecutionResult(ok = false, error = exc.message ?: exc::class.simpleName)
        }
    }
}
