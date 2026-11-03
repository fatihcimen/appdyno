package dev.appdyno.agent

/** `quietMs`: the window in effect at the end (stretched on a loaded device). */
class SettleOutcome<S>(val settled: Boolean, val reads: Int, val last: S, val elapsedMs: Long, val quietMs: Long = 0)

/**
 * After an action: call the screen settled once it has been still for `quietMs` — no layout change between
 * reads, no progress indicator, and no layout-moving accessibility event (events alone hold it for at most
 * twice `quietMs`: an endless animation never goes quiet). The first read is compared with the layout the
 * caller saw before the action, so an action that changed nothing ends after `quietMs`. The window stretches
 * (up to 4×) while the device's own reads are slower than its recent best: a loaded device starts its reaction
 * later. At most `maxMs` after the action. Time, sleep and the event clock are given, so the logic runs in a
 * unit test.
 *
 * Reads load the app (each is a call on its UI thread), so one happens only when it can decide something:
 * while `hold` says there is nothing to read (no app window, a window transition that has not shown its new
 * window) none at all; after a read that saw a change another POLL_MS later, as a move without events shows
 * only in reads; else when the window would be over, or sooner if an event ends `sleep` early.
 */
class Settler(
    private val clock: () -> Long,
    /** Waits up to the given time; an accessibility event may end it early. */
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
        val byReads = if (readCosts.size < 3) 1.0 else readCosts.last() / readCosts.min().coerceAtLeast(0.01) / 2
        return maxOf(byReads, lateness).coerceIn(1.0, 4.0)
    }

    /**
     * How late this thread wakes from its sleeps, smoothed (1: on time), against a sleep of 80 ms: a
     * CPU-starved device wakes late whatever the screen's size, and starts the app's reaction late as well.
     */
    private var lateness = 1.0

    /** A sleep for up to `ms`; true when it ran its full time (no event ended it). */
    private fun pause(ms: Long): Boolean {
        val start = clock()
        sleep(ms)
        val late = clock() - start - ms
        if (late < 0) return false
        // a sleep cut short by the deadline says nothing; half the old value, half the new
        if (ms >= POLL_MS / 2) lateness = (lateness + (80 + late).toDouble() / 80) / 2
        return true
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
        /** Nothing worth reading now (cheap, no call to the app): no read, and nothing is proven meanwhile. */
        hold: () -> Boolean = { false },
        /** A read already overtaken (cheap, no call to the app): the screen it shows has been replaced. */
        outdated: (S) -> Boolean = { false },
    ): SettleOutcome<S> {
        val deadline = actionAt + maxMs
        var reads = 0
        // the layout counts as changed at the action unless it is the one the caller saw
        var last: S? = before
        var changedAt = actionAt
        var lastReadAt = actionAt
        var held = false
        // with the caller's layout known, a read before the window ends can only say "the same"
        var nextRead = if (before != null) actionAt + quietMs else actionAt
        while (true) {
            val t = clock()
            if (t < nextRead && t < deadline && !cancelled()) {
                // an event ends the sleep; the app gets POLL_MS between two reads whatever it sends
                if (!pause(minOf(nextRead, deadline) - t)) {
                    while (clock() < minOf(lastReadAt + POLL_MS, deadline)) sleep(minOf(lastReadAt + POLL_MS, deadline) - clock())
                }
            }
            if (clock() < deadline && hold() && !cancelled()) {
                changedAt = clock()
                nextRead = changedAt
                pause(minOf(POLL_MS, deadline - changedAt).coerceAtLeast(1))
                held = true
                continue
            }
            // a new window's first layout passes are still landing; a read of them costs more than it tells
            if (held && clock() < deadline) {
                val until = minOf(clock() + AFTER_HOLD_MS, deadline)
                while (clock() < until) sleep(until - clock())
            }
            held = false
            val readStart = clock()
            val next = read()
            reads++
            val now = clock()
            lastReadAt = now
            noteRead(now - readStart, size(next))
            val quiet = (quietMs * slowdown()).toLong()
            val prev = last
            // a read shows the layout as it was when it began: stillness is proven up to its start only
            val moved = prev == null || !same(next, prev) || busy(next)
            if (moved) changedAt = readStart
            last = next
            val stillLayout = readStart - changedAt
            val quietEvents = now - maxOf(lastEventAt(), actionAt)
            // a read slower than the window could be all of the "still" time: one more, on a loaded device
            val settled = prev != null && !busy(next) && now - readStart <= quiet &&
                ((stillLayout >= quiet && quietEvents >= quiet) || stillLayout >= 2 * quiet)
            // a read is answered on the app's UI thread, after a click it was still busy with: what that click started
            // shows only now
            if (settled && now < deadline && (outdated(next) || hold())) {
                changedAt = now
                nextRead = now
                continue
            }
            if (settled) return SettleOutcome(true, reads, next, now - actionAt, quiet)
            if (cancelled() || now >= deadline) return SettleOutcome(false, reads, next, now - actionAt, quiet)
            // the moment a read could end this; a move shows only in reads when it sends no events, so it is followed
            val proof = minOf(maxOf(changedAt + quiet, lastEventAt() + quiet), changedAt + 2 * quiet)
            nextRead = if (moved) minOf(now + POLL_MS, proof) else proof
        }
    }

    companion object {
        const val POLL_MS = 40L
        const val AFTER_HOLD_MS = 90L
    }
}
