package dev.appdyno.agent

/** The protocol's error codes, in the order that gives their JSON-RPC numbers (-32000 minus index). */
val ERROR_CODES = listOf(
    "TIMEOUT",
    "CANCELLED",
    "DEVICE_GONE",
    "AGENT_UNAVAILABLE",
    "AGENT_CONFLICT",
    "AGENT_VERSION_MISMATCH",
    "UNSUPPORTED",
    "PERMISSION_REQUIRED",
    "NOT_FOUND",
    "NO_FOCUS",
    "APP_NOT_RUNNING",
    "POLICY_DENIED",
    "INVALID_ARGUMENT",
    "INTERNAL",
)

/** An unknown code is sent as INTERNAL (the last one). */
fun rpcCode(code: String): Int {
    val i = ERROR_CODES.indexOf(code)
    return -32000 - (if (i < 0) ERROR_CODES.size - 1 else i)
}

/** A failure the host gets as a typed error (code, message, what to do). */
class AgentFailure(val code: String, message: String, val hint: String? = null, cause: Throwable? = null) :
    Exception(message, cause)
