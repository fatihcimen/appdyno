package dev.appdyno.agent

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * The agent's device work: one thread, jobs in order. When a job is still running `graceMs` after no one waits for it
 * any more, cancelled or past its deadline (a stuck accessibility or input call: a touch's injection waits on an app
 * held for its crash dialog), its thread is given up (interrupted) and the jobs behind it go on, in order, on a new
 * thread: one stuck call never turns every later request into a TIMEOUT. The given-up thread finishes on its own, if
 * ever; its job's answer was the TIMEOUT or the cancel, and it makes no touch after it (Job.goOn).
 */
class WorkLane(private val timers: ScheduledExecutorService, private val graceMs: Long = 200) {
    @Volatile
    private var lane: ExecutorService = newLane()

    /** Threads given up so far (for the agent's health). */
    val replaced = AtomicInteger()

    private fun newLane(): ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "appdyno-actions").apply { isDaemon = true } }

    /** Runs `work` after the jobs before it; `onTimeout` once `deadlineMs` passes before it ends. */
    fun submit(job: Job, deadlineMs: Long, onTimeout: () -> Unit, work: () -> Unit) {
        // set and read under the lane's monitor: a let-go that looked before the job ended gave up the thread that had
        // gone on to the next job, and interrupted that one
        val finished = AtomicBoolean(false)
        // the thread's lane, taken when the job starts (it may have moved to a new lane while it waited)
        val ranOn = AtomicReference<ExecutorService?>()
        job.onCancel = {
            timers.schedule({ ranOn.get()?.let { giveUp(it, finished) } }, graceMs, TimeUnit.MILLISECONDS)
        }
        val timeout = timers.schedule({
            job.cancelled = true
            onTimeout()
        }, deadlineMs, TimeUnit.MILLISECONDS)
        // never onto a lane being given up (its executor refuses new work)
        synchronized(this) {
            lane.execute {
                ranOn.set(lane)
                try {
                    work()
                } finally {
                    synchronized(this) { finished.set(true) }
                    timeout.cancel(false)
                }
            }
        }
    }

    @Synchronized
    private fun giveUp(stuck: ExecutorService, finished: AtomicBoolean) {
        if (lane !== stuck || finished.get()) return
        val next = newLane()
        lane = next
        replaced.incrementAndGet()
        System.err.println("a job outlived its deadline: its thread is given up, the next jobs run on a new one")
        for (r in stuck.shutdownNow()) next.execute(r)
    }
}
