package dev.appdyno.agent

class SettleOutcome(val settled: Boolean, val reads: Int, val hash: String, val elapsedMs: Long)

/**
 * After an action: wait until no accessibility event came for `quietMs`, read the layout digest, and
 * read again until two reads in a row agree, at most `maxMs` after the action. A first read equal to the
 * digest the caller saw before the action is the settled screen at once (nothing moved). Time, sleep and
 * the event clock are given, so the logic runs in a unit test.
 */
class Settler(
    private val clock: () -> Long,
    private val sleep: (Long) -> Unit,
    private val lastEventAt: () -> Long,
) {
    fun run(
        actionAt: Long,
        quietMs: Long,
        maxMs: Long,
        before: String?,
        read: () -> String,
        cancelled: () -> Boolean,
    ): SettleOutcome {
        val deadline = actionAt + maxMs
        var reads = 0
        fun waitQuiet(since: Long) {
            while (!cancelled()) {
                val now = clock()
                if (now >= deadline) return
                val quiet = now - maxOf(lastEventAt(), since)
                if (quiet >= quietMs) return
                sleep(minOf(quietMs - quiet, 20L, deadline - now))
            }
        }
        waitQuiet(actionAt)
        var hash = read()
        reads++
        if (before != null && hash == before) return SettleOutcome(true, reads, hash, clock() - actionAt)
        while (!cancelled() && clock() < deadline) {
            waitQuiet(clock())
            val next = read()
            reads++
            if (next == hash) return SettleOutcome(true, reads, next, clock() - actionAt)
            hash = next
        }
        return SettleOutcome(false, reads, hash, clock() - actionAt)
    }
}
