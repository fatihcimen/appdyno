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
        lane.submit(Job(2), 30_000, {}) {
            done.add("second")
            bothDone.countDown()
        }
        lane.submit(Job(3), 30_000, {}) {
            done.add("third")
            bothDone.countDown()
        }
        assertTrue("the stuck job was answered TIMEOUT", timedOut.await(10, TimeUnit.SECONDS))
        // the jobs behind it ran while it is still stuck (it is released only at the end), in order, on a
        // new thread: without the lane given up they would wait for ever
        assertTrue("the jobs behind it ran", bothDone.await(10, TimeUnit.SECONDS))
        assertEquals(listOf("second", "third"), done.toList())
        assertEquals(1, lane.replaced.get())
        release.countDown()
    }

    @Test
    fun aCancelledJobStuckInACallLetsTheJobsBehindItGoAtOnce() {
        // a stroke whose injection waits on an app held for its crash dialog, which its host has refused and cancelled
        val lane = WorkLane(timers, graceMs = 100)
        val release = CountDownLatch(1)
        val started = CountDownLatch(1)
        val next = CountDownLatch(1)
        val stroke = Job(1)
        lane.submit(stroke, 60_000, {}) {
            started.countDown()
            stuckUntil(release)
        }
        lane.submit(Job(2), 60_000, {}) { next.countDown() }
        assertTrue(started.await(10, TimeUnit.SECONDS))
        val cancelledAt = System.nanoTime()
        stroke.cancelled = true
        // without the cancel freeing the lane, the read behind it waited for the stroke's deadline, a minute here
        assertTrue("the job behind it ran", next.await(5, TimeUnit.SECONDS))
        assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - cancelledAt) < 2_000)
        assertEquals(1, lane.replaced.get())
        release.countDown()
    }

    @Test
    fun aJobThatEndsInTimeKeepsItsThread() {
        val lane = WorkLane(timers, graceMs = 50)
        val ran = CountDownLatch(3)
        val threads = Collections.synchronizedSet(mutableSetOf<Thread>())
        repeat(3) { i ->
            lane.submit(Job(i), 1_000, {}) {
                threads.add(Thread.currentThread())
                ran.countDown()
            }
        }
        assertTrue(ran.await(10, TimeUnit.SECONDS))
        // past every deadline and grace: nothing was given up
        Thread.sleep(1_200)
        assertEquals(1, threads.size)
        assertEquals(0, lane.replaced.get())
    }
}
