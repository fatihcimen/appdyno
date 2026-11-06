package dev.appdyno.agent

import java.util.concurrent.ConcurrentHashMap

/** A request in flight; `cancelled` is polled by every loop that can run long. */
class Job(val id: Int) {
    @Volatile
    var cancelled = false
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
