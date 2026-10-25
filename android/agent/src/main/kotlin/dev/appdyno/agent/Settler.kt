package dev.appdyno.agent

class SettleOutcome<S>(val settled: Boolean, val reads: Int, val last: S, val elapsedMs: Long)

/**
 * After an action: read the layout every POLL_MS and call the screen settled once it has been still for
 * `quietMs` — no layout change between reads, no progress indicator, and no layout-moving accessibility
 * event (events alone hold it for at most twice `quietMs`: an endless animation never goes quiet). The
 * first read is compared with the layout the caller saw before the action, so an action that changed
 * nothing ends after `quietMs`. At most `maxMs` after the action. Time, sleep and the event clock are
 * given, so the logic runs in a unit test.
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
        // the layout counts as changed at the action unless it is the one the caller saw
        var last: S? = before
        var changedAt = actionAt
        while (true) {
            val next = read()
            reads++
            val now = clock()
            val prev = last
            if (prev == null || !same(next, prev) || busy(next)) changedAt = now
            last = next
            val stillLayout = now - changedAt
            val quietEvents = now - maxOf(lastEventAt(), actionAt)
            val settled = prev != null && !busy(next) &&
                ((stillLayout >= quietMs && quietEvents >= quietMs) || stillLayout >= 2 * quietMs)
            if (settled) return SettleOutcome(true, reads, next, now - actionAt)
            if (cancelled() || now >= deadline) return SettleOutcome(false, reads, next, now - actionAt)
            sleep(minOf(POLL_MS, deadline - now).coerceAtLeast(1))
        }
    }

    companion object {
        const val POLL_MS = 80L
    }
}
