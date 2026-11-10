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
import java.io.OutputStream
import java.lang.reflect.InvocationTargetException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ServerPartsTest {
    private val token = "0123456789abcdef"

    private val files = mapOf("t" to "$token\n", "short" to "short")
    private fun parse(vararg args: String) = Options.parse(arrayOf(*args)) { files[it] ?: throw java.io.FileNotFoundException(it) }

    @Test
    fun theOptionsNameASafeSocketAndALongTokenInAFile() {
        val o = parse("--socket", "appdyno_1", "--token-file", "t", "--idle-exit-ms", "5")
        assertEquals("appdyno_1", o.socket)
        assertEquals(token, o.token)
        assertEquals(5L, o.idleExitMs)
        assertEquals(30 * 60_000L, parse("--socket", "a", "--token-file", "t").idleExitMs)
    }

    @Test
    fun badOptionsAreRefused() {
        val bad = listOf(
            arrayOf("--token-file", "t"),
            arrayOf("--socket", "a"),
            arrayOf("--socket", "a b", "--token-file", "t"),
            arrayOf("--socket", "a", "--token-file", "short"),
            arrayOf("--socket", "a", "--token-file", "gone"),
            arrayOf("--socket", "a", "--token", token),
        )
        for (args in bad) assertThrows(IllegalArgumentException::class.java) { parse(*args) }
    }

    @Test
    fun aCancelReachesTheJobOfItsOwnConnectionAlone() {
        val (mine, theirs) = JobTable() to JobTable()
        val (own, other) = Job(1) to Job(1)
        mine.add(own)
        theirs.add(other)
        theirs.cancel(1)
        assertTrue(other.cancelled)
        assertFalse(own.cancelled)
        mine.cancel(2)
        assertFalse(own.cancelled)
    }

    @Test
    fun theEndOfAJobLeavesAnotherOfItsIdWhereItIs() {
        val jobs = JobTable()
        val (old, new) = Job(1) to Job(1)
        jobs.add(old)
        jobs.add(new)
        jobs.remove(old)
        jobs.cancel(1)
        assertTrue(new.cancelled)
        jobs.remove(new)
        val after = Job(1)
        jobs.cancel(1)
        assertFalse(after.cancelled)
    }

    @Test
    fun aJobTheHostNoLongerWaitsForGoesNoFurther() {
        val job = Job(1)
        job.goOn()
        job.cancelled = true
        // what it would still do stops there: a touch, text, or the settle after them
        assertEquals("CANCELLED", assertThrows(AgentFailure::class.java) { job.goOn() }.code)
    }

    @Test
    fun theEndOfAConnectionCancelsEachOfItsJobsAlone() {
        val (mine, theirs) = JobTable() to JobTable()
        val (queued, running, other) = Triple(Job(1), Job(2), Job(1))
        mine.add(queued)
        mine.add(running)
        theirs.add(other)
        mine.cancelAll()
        assertTrue(queued.cancelled)
        assertTrue(running.cancelled)
        assertFalse(other.cancelled)
    }

    @Test
    fun aTimeoutWhoseWriteIsHeldHoldsNoOtherTimeout() {
        val held = CountDownLatch(1)
        val writing = CountDownLatch(1)
        // a host that stopped reading: a write waits for good
        val blocked = object : OutputStream() {
            override fun write(b: Int) {
                writing.countDown()
                held.await()
            }
        }
        val answer = OneAnswer(7, FrameWriter(blocked))
        val timers = Executors.newSingleThreadScheduledExecutor()
        try {
            // on the timers thread it returns while its write waits, on another thread
            timers.submit { answer.timeout(AgentFailure("TIMEOUT", "late")) }.get(2, TimeUnit.SECONDS)
            assertTrue(writing.await(2, TimeUnit.SECONDS))
            assertTrue(timers.submit<Boolean> { true }.get(2, TimeUnit.SECONDS))
            // the job's own answer, later, is not written: the host has its TIMEOUT
            var gave = false
            answer.give { gave = true }
            assertFalse(gave)
        } finally {
            held.countDown()
            timers.shutdownNow()
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
