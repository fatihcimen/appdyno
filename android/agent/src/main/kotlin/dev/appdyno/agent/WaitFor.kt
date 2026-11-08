package dev.appdyno.agent

import android.os.SystemClock
import org.json.JSONObject

/** `last`: the read to answer with; null when the screen stayed the one `since` named. */
class WaitOutcome<S>(val sig: String, val changed: Boolean, val reads: Int, val elapsedMs: Long, val last: S?)

/**
 * `wait`: reads until the screen differs from the digest the caller holds. Time and sleep are given, so
 * the loop runs in a unit test.
 */
object WaitFor {
    const val POLL_MS = 80L

    /** All a caller sees of a screen, texts too, unlike the layout digest. FNV-1a 64, hex. */
    fun sig(windows: List<String>, nodes: List<CNode>): String {
        var h = -0x340d631b7bdddcdbL // FNV-1a 64 offset basis
        fun mix(s: String?) {
            for (ch in s ?: "\u0000") h = (h xor ch.code.toLong()) * 0x100000001b3L
            // a field's end: "ab","c" is not "a","bc"
            h = (h xor 1L) * 0x100000001b3L
        }
        mix(windows.size.toString())
        for (w in windows) mix(w)
        for (n in nodes) {
            mix(n.cls)
            mix(n.id)
            mix(n.text)
            mix(n.desc)
            mix("${n.left},${n.top},${n.right},${n.bottom},${n.flags}")
        }
        return java.lang.Long.toHexString(h)
    }

    /** A window as the tree sends it. */
    fun window(w: CWindow) = "${w.type}|${w.pkg}|${w.layer}|${w.bounds.left},${w.bounds.top},${w.bounds.right},${w.bounds.bottom}|${w.active}|${w.focused}"

    fun <S> run(
        since: String?,
        timeoutMs: Long,
        minMs: Long,
        clock: () -> Long,
        sleep: (Long) -> Unit,
        cancelled: () -> Boolean,
        read: () -> S,
        sigOf: (S) -> String,
    ): WaitOutcome<S> {
        val start = clock()
        var reads = 0
        while (true) {
            if (cancelled()) throw AgentFailure("CANCELLED", "wait was cancelled")
            val next = read()
            reads++
            val sig = sigOf(next)
            val elapsed = clock() - start
            // a timeout shorter than minMs still tells of the change it saw
            if (since == null || (sig != since && elapsed >= minOf(minMs, timeoutMs))) {
                return WaitOutcome(sig, true, reads, elapsed, next)
            }
            if (elapsed >= timeoutMs) return WaitOutcome(since, false, reads, elapsed, null)
            sleep(minOf(POLL_MS, timeoutMs - elapsed))
        }
    }

    fun handle(r: WaitRequest, job: Job, read: () -> Capture, tree: (Capture) -> JSONObject): Reply {
        val o = run(
            r.since,
            r.timeoutMs,
            r.minMs,
            { SystemClock.uptimeMillis() },
            { Thread.sleep(it) },
            { job.cancelled },
            read,
            { c -> sig(c.windows.map(::window), c.nodes) },
        )
        return Reply(Results.wait(o, o.last?.let(tree)))
    }
}
