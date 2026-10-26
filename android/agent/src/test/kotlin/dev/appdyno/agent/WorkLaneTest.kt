package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class WorkLaneTest {
    private val timers = Executors.newSingleThreadScheduledExecutor()

    /** A call that never returns and shrugs off interrupts (a stuck binder call). */
    private fun stuckUntil(release: CountDownLatch) {
        while (release.count > 0) {
            try {
                release.await()
            } catch (_: InterruptedException) {
            }
        }
    }

    @Test
    fun aJobStuckPastItsDeadlineDoesNotHoldTheJobsBehindIt() {
        val lane = WorkLane(timers, graceMs = 200)
        val release = CountDownLatch(1)
        val timedOut = CountDownLatch(1)
        val done = Collections.synchronizedList(mutableListOf<String>())
        val bothDone = CountDownLatch(2)
        lane.submit(Job(1), 100, { timedOut.countDown() }) { stuckUntil(release) }
        val t0 = System.nanoTime()
        lane.submit(Job(2), 5_000, {}) { done.add("second"); bothDone.countDown() }
        lane.submit(Job(3), 5_000, {}) { done.add("third"); bothDone.countDown() }
        assertTrue("the stuck job was answered TIMEOUT", timedOut.await(2, TimeUnit.SECONDS))
        assertTrue("the jobs behind it ran", bothDone.await(3, TimeUnit.SECONDS))
        val ms = (System.nanoTime() - t0) / 1_000_000
        // deadline 100 ms + grace 200 ms, then at once on the new thread
        assertTrue("took $ms ms", ms < 1_500)
        assertEquals(listOf("second", "third"), done.toList())
        assertEquals(1, lane.replaced.get())
        release.countDown()
    }

    @Test
    fun aJobThatEndsInTimeKeepsItsThread() {
        val lane = WorkLane(timers, graceMs = 50)
        val ran = CountDownLatch(3)
        val threads = Collections.synchronizedSet(mutableSetOf<Thread>())
        repeat(3) { i ->
            lane.submit(Job(i), 1_000, {}) { threads.add(Thread.currentThread()); ran.countDown() }
        }
        assertTrue(ran.await(2, TimeUnit.SECONDS))
        Thread.sleep(1_200)
        assertEquals(1, threads.size)
        assertEquals(0, lane.replaced.get())
    }
}
