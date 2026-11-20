package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TapFocusTest {
    /** A device whose focus is `focus` from each of its times (ms after the tap), on a clock that moves by what is slept. */
    private class Device(vararg focus: Pair<Long, String?>) {
        val changes = focus.toMutableList()
        var at = 0L
        var focused = mutableListOf<String>()
        var retaps = 0

        fun now() = changes.last { it.first <= at }.second

        fun wait(deadline: Long, meant: (String) -> Boolean) = FocusWait.until(deadline, { false }, { at }, { at += it }) { now()?.takeIf(meant) }

        fun field(old: String?, pick: String?) = TapFocus.field(old, 0, 5_000, ::wait, { pick }, { f ->
            focused += f
            changes += at + 200 to f
        }) { retaps++ }
    }

    @Test
    fun aSecondFieldIsTypedIntoOnceChromeTellsItHasTheFocus() {
        // httpbin's form: Customer name typed, Delivery instructions tapped; Chrome names the first focused for 300 ms
        val d = Device(0L to "customer", 300L to "delivery")
        assertEquals("delivery", d.field(old = "customer", pick = "delivery"))
        assertEquals(320L, d.at)
        assertEquals(listOf<String>(), d.focused)
    }

    @Test
    fun theFieldTypedBeforeIsNeverTheOneTappedAfter() {
        val d = Device(0L to "customer")
        assertEquals("delivery", d.field(old = "customer", pick = "delivery"))
        assertEquals(listOf("delivery"), d.focused)
        assertEquals(0, d.retaps)
    }

    @Test
    fun noFieldAtThePointLeavesTheTextUntyped() {
        val d = Device(0L to "customer")
        assertNull(d.field(old = "customer", pick = null))
        assertEquals(1, d.retaps)
        assertEquals(5_000L, d.at)
    }

    @Test
    fun theFieldBeforeIsMeantWhereThePointNamesIt() {
        // the point is on its layout's helper text, below the field that has the focus
        val d = Device(0L to "name")
        assertEquals("name", d.field(old = "name", pick = "name"))
        assertEquals(listOf<String>(), d.focused)
    }

    @Test
    fun aFieldThatOpensElsewhereIsTyped() {
        // Wikipedia's search box opens a screen whose field is at its top, away from the point
        val d = Device(0L to null, 600L to "search")
        assertEquals("search", d.field(old = null, pick = null))
    }
}
