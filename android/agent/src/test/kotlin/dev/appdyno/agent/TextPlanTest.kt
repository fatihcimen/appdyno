package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TextPlanTest {
    @Test
    fun appendsOrReplaces() {
        assertEquals("abc", TextPlan.target("ab", "c", false))
        assertEquals("c", TextPlan.target("ab", "c", true))
        assertEquals("ç", TextPlan.target(null, "ç", false))
    }

    @Test
    fun turkishIsNotAscii() {
        assertTrue(TextPlan.isAscii("Hello 123"))
        assertFalse(TextPlan.isAscii("İstanbul"))
        assertFalse(TextPlan.isAscii("şğüöçı"))
    }

    @Test
    fun readBackIgnoresTrailingLineBreak() {
        assertTrue(TextPlan.matches("abc\n", "abc"))
        assertFalse(TextPlan.matches("ab", "abc"))
    }
}
