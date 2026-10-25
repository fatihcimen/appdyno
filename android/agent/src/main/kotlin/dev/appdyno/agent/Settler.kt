package dev.appdyno.agent

class SettleOutcome<S>(val settled: Boolean, val reads: Int, val last: S, val elapsedMs: Long)

/**
 * After an action: wait until no accessibility event came for `quietMs`, read the layout, and read again
 * until two reads in a row are the same layout (`same`), at most `maxMs` after the action. A first read
 * the same as the layout the caller saw before the action is the settled screen at once. A read that
 * still shows a progress indicator never counts as settled: content is on its way. A screen whose events
 * never stop (an endless animation) is read after two quiet windows' time instead. Time, sleep and the
 * event clock are given, so the logic runs in a unit test.
 */
class Settler(
    private val clock: () -> Long,
    private val sleep: (Long) -> Unit,
    private val lastEventAt: () -> Long,
) {
    fun <S> run(
        actionAt: Long,
        quietMs: Long,
        maxMs: Long,
        before: S?,
        read: () -> S,
        same: (S, S) -> Boolean,
        busy: (S) -> Boolean,
        cancelled: () -> Boolean,
    ): SettleOutcome<S> {
        val deadline = actionAt + maxMs
        var reads = 0
        // a screen that animates without end never goes quiet: after this long the reads decide alone
        val patience = quietMs * 2
        fun waitQuiet(since: Long) {
            val giveUp = since + patience
            while (!cancelled()) {
                val now = clock()
                if (now >= deadline || now >= giveUp) return
                val quiet = now - maxOf(lastEventAt(), since)
                if (quiet >= quietMs) return
                sleep(minOf(quietMs - quiet, 20L, deadline - now))
            }
        }
        waitQuiet(actionAt)
        var last = read()
        reads++
        if (before != null && !busy(last) && same(last, before)) return SettleOutcome(true, reads, last, clock() - actionAt)
        while (!cancelled() && clock() < deadline) {
            waitQuiet(clock())
            val next = read()
            reads++
            if (!busy(next) && same(next, last)) return SettleOutcome(true, reads, next, clock() - actionAt)
            last = next
        }
        return SettleOutcome(false, reads, last, clock() - actionAt)
    }
}
