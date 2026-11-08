package dev.appdyno.agent

import org.json.JSONObject

/*
 * A request as the host sends it. `RpcClient.call` parses its params by the protocol's schema, so a value with a
 * default is always here and this side has none of its own; one that is missing is the caller's INVALID_ARGUMENT.
 * The unit tests read the protocol's fixtures through these.
 */

class TreeRequest(val maxDepth: Int, val maxNodes: Int) {
    companion object {
        fun from(p: JSONObject) = TreeRequest(p.getInt("maxDepth"), p.getInt("maxNodes"))
    }
}

class SettleRequest(val quietMs: Long, val maxMs: Long)

/** What an action asks for once it is done. */
class AfterRequest(val settle: SettleRequest?, val read: String, val before: String?) {
    companion object {
        fun from(p: JSONObject) = AfterRequest(
            p.optJSONObject("settle")?.let { SettleRequest(it.getLong("quietMs"), it.getLong("maxMs")) },
            p.getString("read"),
            if (p.has("before")) p.getString("before") else null,
        )
    }
}

sealed class Action {
    class Tap(val x: Float, val y: Float) : Action()
    class DoubleTap(val x: Float, val y: Float) : Action()
    class LongPress(val x: Float, val y: Float, val durationMs: Long) : Action()
    class Swipe(val from: Pair<Float, Float>, val to: Pair<Float, Float>, val durationMs: Long) : Action()
    class Gesture(val pointers: List<List<Sample>>) : Action()
    class Key(val key: String, val modifiers: List<String>) : Action()

    companion object {
        fun from(a: JSONObject): Action = when (a.getString("kind")) {
            "tap" -> Tap(a.x(), a.y())

            "doubleTap" -> DoubleTap(a.x(), a.y())

            "longPress" -> LongPress(a.x(), a.y(), a.getLong("durationMs"))

            "swipe" -> Swipe(a.getJSONObject("from").point(), a.getJSONObject("to").point(), a.getLong("durationMs"))

            "gesture" -> {
                val pointers = a.getJSONArray("pointers")
                Gesture(
                    (0 until pointers.length()).map { i ->
                        val pts = pointers.getJSONArray(i)
                        (0 until pts.length()).map { j ->
                            val s = pts.getJSONObject(j)
                            Sample(s.getLong("t"), s.x(), s.y())
                        }
                    },
                )
            }

            "key" -> {
                val held = a.optJSONArray("modifiers")
                Key(a.getString("key"), (0 until (held?.length() ?: 0)).map { held!!.getString(it) })
            }

            else -> throw AgentFailure("INVALID_ARGUMENT", "unknown action")
        }
    }
}

class TextRequest(
    val text: String,
    val replace: Boolean,
    val submit: Boolean,
    val at: Pair<Float, Float>?,
    val focusTimeoutMs: Long,
    val after: AfterRequest,
) {
    companion object {
        fun from(p: JSONObject) = TextRequest(
            p.getString("text"),
            p.getBoolean("replace"),
            p.getBoolean("submit"),
            p.optJSONObject("at")?.point(),
            p.getLong("focusTimeoutMs"),
            AfterRequest.from(p),
        )
    }
}

class ShotRequest(val png: Boolean, val quality: Int, val maxPx: Int?) {
    companion object {
        fun from(p: JSONObject) = ShotRequest(
            p.getString("format") == "png",
            p.getInt("quality"),
            if (p.has("maxPx")) p.getInt("maxPx") else null,
        )
    }
}

class WaitRequest(val since: String?, val timeoutMs: Long, val minMs: Long) {
    companion object {
        fun from(p: JSONObject) = WaitRequest(if (p.has("since")) p.getString("since") else null, p.getLong("timeoutMs"), p.getLong("minMs"))
    }
}

/** A person's finger: one phase of a touch, in fractions of the screen, with a second finger's place if there is one. */
class TouchRequest(val phase: Int, val x: Float, val y: Float, val x2: Float?, val y2: Float?) {
    companion object {
        fun from(p: JSONObject) = TouchRequest(
            p.getInt("p"),
            p.x(),
            p.y(),
            if (p.has("x2")) p.getDouble("x2").toFloat() else null,
            if (p.has("y2")) p.getDouble("y2").toFloat() else null,
        )
    }
}

/** The requests that carry one value. */
object OneValue {
    fun text(p: JSONObject): String = p.getString("text")

    fun off(p: JSONObject) = p.getBoolean("off")

    fun rotation(p: JSONObject) = p.getInt("rotation")

    fun maxNodes(p: JSONObject) = p.getInt("maxNodes")

    fun id(p: JSONObject) = p.getInt("id")

    /** Language tags to set, if any. */
    fun tags(p: JSONObject): String? = p.optString("set").takeIf { it.isNotEmpty() }
}

private fun JSONObject.x() = getDouble("x").toFloat()

private fun JSONObject.y() = getDouble("y").toFloat()

private fun JSONObject.point() = x() to y()
