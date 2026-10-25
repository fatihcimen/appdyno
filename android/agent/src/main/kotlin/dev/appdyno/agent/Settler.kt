package dev.appdyno.agent

class SettleOutcome<S>(val settled: Boolean, val reads: Int, val last: S, val elapsedMs: Long)

/**
 * After an action: read the layout every POLL_MS and call the screen settled once it has been still for
 * `quietMs` — no layout change between reads, no progress indicator, and no layout-moving accessibility
 * event (events alone hold it for at most twice `quietMs`: an endless animation never goes quiet). The
 * first read is compared with the layout the caller saw before the action, so an action that changed
 * nothing ends after `quietMs`. The window stretches (up to 4×) while the device's own reads are slower
 * than its recent best: a loaded device starts its reaction later. At most `maxMs` after the action. Time, sleep and the event clock are
 * given, so the logic runs in a unit test.
 */
class Settler(
    private val clock: () -> Long,
    private val sleep: (Long) -> Unit,
    private val lastEventAt: () -> Long,
) {
    /** Recent read costs: ms per node (a bigger screen takes longer to read without any load). */
    private val readCosts = ArrayDeque<Double>()

    /**
     * How much slower the device is now than at its best lately: the last read's cost per node over the
     * cheapest of the recent ones, halved (1 to 4). A loaded device reacts later too, so the quiet window
     * stretches with it.
     */
    fun slowdown(): Double {
        if (readCosts.size < 3) return 1.0
        val best = readCosts.min().coerceAtLeast(0.01)
        return (readCosts.last() / best / 2).coerceIn(1.0, 4.0)
    }

    private fun noteRead(ms: Long, nodes: Int) {
        readCosts.addLast(ms.toDouble() / nodes.coerceAtLeast(20))
        while (readCosts.size > 30) readCosts.removeFirst()
    }

    fun <S> run(
        actionAt: Long,
        quietMs: Long,
        maxMs: Long,
        before: S?,
        read: () -> S,
        same: (S, S) -> Boolean,
        busy: (S) -> Boolean,
        cancelled: () -> Boolean,
        /** The size of a read (its node count), so its time can be compared across screens. */
        size: (S) -> Int = { 100 },
    ): SettleOutcome<S> {
        val deadline = actionAt + maxMs
        var reads = 0
        // the layout counts as changed at the action unless it is the one the caller saw
        var last: S? = before
        var changedAt = actionAt
        while (true) {
            val readStart = clock()
            val next = read()
            reads++
            val now = clock()
            noteRead(now - readStart, size(next))
            val quiet = (quietMs * slowdown()).toLong()
            val prev = last
            if (prev == null || !same(next, prev) || busy(next)) changedAt = now
            last = next
            val stillLayout = now - changedAt
            val quietEvents = now - maxOf(lastEventAt(), actionAt)
            val settled = prev != null && !busy(next) &&
                ((stillLayout >= quiet && quietEvents >= quiet) || stillLayout >= 2 * quiet)
            if (settled) return SettleOutcome(true, reads, next, now - actionAt)
            if (cancelled() || now >= deadline) return SettleOutcome(false, reads, next, now - actionAt)
            sleep(minOf(POLL_MS, deadline - now).coerceAtLeast(1))
        }
    }

    companion object {
        const val POLL_MS = 80L
    }
}
