package dev.appdyno.agent

import org.json.JSONObject
import java.lang.reflect.InvocationTargetException

/** The wire's version: `PROTOCOL.major`. */
const val PROTOCOL_MAJOR = 2

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
    "STALE",
    "SCREEN_OFF",
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

fun unknownMethod(method: String) = AgentFailure("UNSUPPORTED", "unknown method $method")

/** What a thrown failure tells the host. */
fun failureOf(t: Throwable): AgentFailure = when (t) {
    is AgentFailure -> t
    is InvocationTargetException -> failureOf(t.targetException)
    is IllegalArgumentException, is org.json.JSONException ->
        AgentFailure("INVALID_ARGUMENT", t.message ?: t.toString(), cause = t)
    else -> {
        t.printStackTrace()
        AgentFailure("INTERNAL", t.toString(), cause = t)
    }
}

fun resultJson(id: Int, r: JSONObject): String = JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", r).toString()

fun errorJson(id: Int, f: AgentFailure): String {
    val data = JSONObject().put("code", f.code)
    f.hint?.let { data.put("hint", it) }
    val err = JSONObject().put("code", rpcCode(f.code)).put("message", f.message ?: f.code).put("data", data)
    return JSONObject().put("jsonrpc", "2.0").put("id", id).put("error", err).toString()
}

/** Constant-time comparison of the launch token. */
fun sameToken(given: String, token: String): Boolean {
    if (given.length != token.length) return false
    var diff = 0
    for (i in given.indices) diff = diff or (given[i].code xor token[i].code)
    return diff == 0
}
