package dev.appdyno.agent

import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.InvocationTargetException

class ServerPartsTest {
    private val token = "0123456789abcdef"

    @Test
    fun theOptionsNameASafeSocketAndALongToken() {
        val o = Options.parse(arrayOf("--socket", "appdyno_1", "--token", token, "--idle-exit-ms", "5"))
        assertEquals("appdyno_1", o.socket)
        assertEquals(token, o.token)
        assertEquals(5L, o.idleExitMs)
        assertEquals(30 * 60_000L, Options.parse(arrayOf("--socket", "a", "--token", token)).idleExitMs)
    }

    @Test
    fun badOptionsAreRefused() {
        for (args in listOf(arrayOf("--token", token), arrayOf("--socket", "a"), arrayOf("--socket", "a b", "--token", token), arrayOf("--socket", "a", "--token", "short"))) {
            assertThrows(IllegalArgumentException::class.java) { Options.parse(args) }
        }
    }

    @Test
    fun aFailureTellsTheHostWhoseItIs() {
        val typed = AgentFailure("NO_FOCUS", "no field")
        assertSame(typed, failureOf(typed))
        assertSame(typed, failureOf(InvocationTargetException(typed)))
        assertEquals("INVALID_ARGUMENT", failureOf(JSONException("no text")).code)
        assertEquals("INVALID_ARGUMENT", failureOf(IllegalArgumentException("bad")).code)
        assertEquals("INTERNAL", failureOf(IllegalStateException("broken")).code)
    }

    @Test
    fun aResultCarriesItsId() {
        val reply = JSONObject(resultJson(9, JSONObject().put("a", 1)))
        assertEquals("2.0", reply.getString("jsonrpc"))
        assertEquals(9, reply.getInt("id"))
        assertEquals(1, reply.getJSONObject("result").getInt("a"))
    }

    @Test
    fun tokensCompareWhole() {
        assertTrue(sameToken(token, token))
        assertFalse(sameToken("0123456789abcdeX", token))
        assertFalse(sameToken("0123", token))
    }

    @Test
    fun aPictureComesDownByItsLongestSide() {
        assertNull(Screenshots.fitted(1080, 2400, null))
        assertNull(Screenshots.fitted(1080, 2400, 2400))
        assertEquals(540 to 1200, Screenshots.fitted(1080, 2400, 1200))
        assertEquals(1 to 64, Screenshots.fitted(1, 2400, 64))
    }
}
