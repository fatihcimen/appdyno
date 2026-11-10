package dev.appdyno.agent

import java.util.concurrent.ConcurrentHashMap

/** A request in flight; `cancelled` is polled by every loop that can run long. */
class Job(val id: Int) {
    @Volatile
    var cancelled = false

    /**
     * Before a touch or text, and after one: the host no longer waits, told TIMEOUT or CANCELLED, so that it never lands
     * after all, and a job whose lane was given up does not go on beside the next lane's.
     */
    fun goOn() {
        if (cancelled) throw AgentFailure("CANCELLED", "the host no longer waits for it")
    }
}

/**
 * The requests one connection has in flight. A host's ids start at 1 on each connection, so an id names a job only on
 * its own: one table for the process let a host's cancel stop another's job, and the end of either take both off it.
 */
class JobTable {
    private val jobs = ConcurrentHashMap<Int, Job>()

    fun add(job: Job) {
        jobs[job.id] = job
    }

    fun cancel(id: Int) {
        jobs[id]?.cancelled = true
    }

    fun remove(job: Job) {
        jobs.remove(job.id, job)
    }
}
