package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NoWindowTest {
    @Test
    fun aLitScreenIsNotCalledLocked() {
        val lit = noWindow(screenOn = true)
        assertEquals("NOT_FOUND", lit.code)
        assertTrue(lit.message!!, lit.message!!.contains("not answering"))
        assertTrue(lit.message!!, !lit.message!!.contains("locked"))
    }

    @Test
    fun aDarkOneIs() {
        assertTrue(noWindow(screenOn = false).message!!.contains("off or locked"))
    }
}
