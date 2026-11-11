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
        // a formatting field shows the same digits with its own punctuation
        assertTrue(TextPlan.matches("(599) 999-9900", "5999999900"))
        assertFalse(TextPlan.matches("(599) 999-0099", "5999999900"))
        assertFalse(TextPlan.matches("--", "()"))
    }

    @Test
    fun aFieldLimitedBelowTheTextTakesItKeyByKey() {
        assertTrue(TextPlan.keysOnly(1, "9643")) // one box of a code entry
        assertFalse(TextPlan.keysOnly(4, "9643"))
        assertFalse(TextPlan.keysOnly(-1, "9643")) // no limit
        assertFalse(TextPlan.keysOnly(0, "x"))
    }

    @Test
    fun enterFollowsNoTextTheFieldReadBackAsOther() {
        assertFalse(TextPlan.submits(true, false))
        // read back as the text, or not readable (a password, a code entry): submitted as asked
        assertTrue(TextPlan.submits(true, true))
        assertTrue(TextPlan.submits(true, null))
        assertFalse(TextPlan.submits(false, true))
    }
}
