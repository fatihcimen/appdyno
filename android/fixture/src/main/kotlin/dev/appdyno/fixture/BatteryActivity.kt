package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * A known cost to a battery: a partial wake lock of `lock_ms` under the tag `fixture:held`, `alarms` wakeup alarms a
 * second apart, a job. Each by its button, each with no power model in between.
 */
class BatteryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val asked = { name: String, otherwise: Int -> intent.data?.getQueryParameter(name)?.toIntOrNull() ?: otherwise }
        column {
            val status = label("ready", R.id.battery_status)
            button("Hold lock", R.id.battery_lock) {
                val power = getSystemService(android.os.PowerManager::class.java)
                power.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "fixture:held").acquire(asked("lock_ms", 30_000).toLong())
                status.text = "holding"
            }
            button("Alarms", R.id.battery_alarms) {
                val alarms = getSystemService(android.app.AlarmManager::class.java)
                val count = asked("alarms", 6)
                var rung = 0
                repeat(count) { i ->
                    alarms.setExact(
                        android.app.AlarmManager.RTC_WAKEUP,
                        System.currentTimeMillis() + (i + 1) * 1_000L,
                        "fixture.alarm",
                        { if (++rung == count) status.text = "rang $rung" },
                        Handler(Looper.getMainLooper()),
                    )
                }
                status.text = "set $count"
            }
            button("Job", R.id.battery_job) {
                val jobs = getSystemService(android.app.job.JobScheduler::class.java)
                val at = android.content.ComponentName(this@BatteryActivity, FixtureJob::class.java)
                jobs.schedule(android.app.job.JobInfo.Builder(1, at).setOverrideDeadline(0).build())
                status.text = "scheduled"
            }
        }
    }
}
