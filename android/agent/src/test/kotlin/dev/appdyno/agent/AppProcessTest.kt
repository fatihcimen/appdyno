package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class AppProcessTest {
    @Test
    fun theProcessIsTheOldestOfThoseOfItsName() {
        assertEquals(4242, AppProcess.first(intArrayOf(5310, 4242)))
    }

    @Test
    fun anAppWithNoProcessIsZero() {
        assertEquals(0, AppProcess.first(intArrayOf()))
        assertEquals(0, AppProcess.first(null))
    }
}
