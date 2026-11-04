package dev.appdyno.fixture

/** A job that ends at once: what a count of jobs must read. */
class FixtureJob : android.app.job.JobService() {
    override fun onStartJob(params: android.app.job.JobParameters?) = false
    override fun onStopJob(params: android.app.job.JobParameters?) = false
}
