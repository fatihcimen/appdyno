package dev.appdyno.agent

import android.graphics.Rect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WaitForTest {
    private var now = 1_000L

    private fun node(cls: String = "View", id: String? = "x", text: String? = "a", desc: String? = "d", right: Int = 10, flags: Int = 1) = CNode(-1, 0, cls, id, text, desc, null, 0, 0, right, 10, flags)

    private fun sig(n: CNode, window: String = "w") = WaitFor.sig(listOf(window), listOf(n))

    /** Reads take 10 ms; `sigAt(t)` is the screen's digest at t after the start. */
    private fun go(since: String?, timeout: Long = 1_000, min: Long = 300, cancelled: () -> Boolean = { false }, sigAt: (Long) -> String): WaitOutcome<String> {
        val start = now
        return WaitFor.run(since, timeout, min, { now }, { now += it }, cancelled, {
            now += 10
            sigAt(now - start)
        }, { it })
    }

    @Test
    fun everyFieldCountsInTheDigest() {
        val base = sig(node())
        assertEquals(base, sig(node()))
        for (other in listOf(node(cls = "Text"), node(id = "y"), node(id = null), node(text = "b"), node(text = null), node(text = ""), node(desc = "e"), node(right = 11), node(flags = 3))) {
            assertNotEquals(base, sig(other))
        }
        assertNotEquals(base, sig(node(), window = "w2"))
        assertNotEquals(base, WaitFor.sig(listOf("w"), listOf(node(), node())))
        assertNotEquals(base, WaitFor.sig(emptyList(), listOf(node())))
    }

    @Test
    fun aFieldsEndCounts() {
        assertNotEquals(sig(node(text = "ab", desc = "c")), sig(node(text = "a", desc = "bc")))
    }

    @Test
    fun aWindowIsDescribedByWhatTheTreeSends() {
        fun w(right: Int = 100, focused: Boolean = true, pkg: String? = "app") = WaitFor.window(CWindow(7, 1, pkg, 0, Rect().apply { this.right = right }, true, focused))
        assertEquals(w(), w())
        assertNotEquals(w(), w(right = 200))
        assertNotEquals(w(), w(focused = false))
        assertNotEquals(w(), w(pkg = "other"))
    }

    @Test
    fun withoutSinceTheFirstReadIsTheAnswer() {
        val o = go(null) { "A" }
        assertTrue(o.changed)
        assertEquals("A", o.sig)
        assertEquals("A", o.last)
        assertEquals(1, o.reads)
        assertEquals(10, o.elapsedMs)
    }

    @Test
    fun anEarlyChangeIsAnsweredOnceMinMsHasPassed() {
        val o = go("A") { t -> if (t >= 100) "B" else "A" }
        assertTrue(o.changed)
        assertEquals("B", o.sig)
        assertEquals("B", o.last)
        assertTrue("answered at ${o.elapsedMs}", o.elapsedMs in 300..390)
    }

    @Test
    fun aLateChangeIsAnsweredAtTheNextRead() {
        val o = go("A") { t -> if (t >= 600) "B" else "A" }
        assertTrue(o.changed)
        assertTrue("answered at ${o.elapsedMs}", o.elapsedMs in 600..690)
    }

    @Test
    fun aChangeThatWentBackBeforeMinMsIsNoChange() {
        val o = go("A") { t -> if (t in 50..200) "B" else "A" }
        assertFalse(o.changed)
    }

    @Test
    fun aStillScreenEndsAtTheTimeoutWithoutATree() {
        val o = go("A") { "A" }
        assertFalse(o.changed)
        assertEquals("A", o.sig)
        assertNull(o.last)
        assertTrue("ended at ${o.elapsedMs}", o.elapsedMs in 1_000..1_010)
        // a read every 80 ms and its own 10
        assertTrue("reads ${o.reads}", o.reads in 11..13)
    }

    @Test
    fun aTimeoutShorterThanMinMsStillTellsOfAChange() {
        val o = go("A", timeout = 100, min = 300) { "B" }
        assertTrue(o.changed)
        assertEquals("B", o.last)
        assertTrue("answered at ${o.elapsedMs}", o.elapsedMs in 100..110)
    }

    @Test
    fun aCancelFailsTheWait() {
        var polls = 0
        val e = assertThrows(AgentFailure::class.java) { go("A", cancelled = { ++polls > 2 }) { "A" } }
        assertEquals("CANCELLED", e.code)
    }
}
