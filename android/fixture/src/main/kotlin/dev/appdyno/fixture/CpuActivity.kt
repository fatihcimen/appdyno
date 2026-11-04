package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle

/**
 * One core busy for 3 s on a background thread; and for a diff of two profiles, 8 s of a second's work over and over:
 * 200 ms in one function, and `files/known_ms` more in another. A tap on Stall holds the main thread for what a test
 * put there: at work for `files/stall_ms` in that function, or asleep for `files/sleep_ms`.
 */
class CpuActivity : Activity() {
    private fun steadyWork() {
        val end = android.os.SystemClock.uptimeMillis() + 200
        var x = 0L
        while (android.os.SystemClock.uptimeMillis() < end) repeat(10_000) { x += x xor 7 }
        if (x == 42L) println(x)
    }

    private fun knownCost(ms: Long) {
        val end = android.os.SystemClock.uptimeMillis() + ms
        var x = 0L
        while (android.os.SystemClock.uptimeMillis() < end) repeat(10_000) { x += x xor 5 }
        if (x == 42L) println(x)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            button("Steady", R.id.cpu_steady) {
                val known = costMs("known_ms")
                Thread {
                    repeat(8) {
                        val next = android.os.SystemClock.uptimeMillis() + 1_000
                        steadyWork()
                        known?.let(::knownCost)
                        Thread.sleep(maxOf(0, next - android.os.SystemClock.uptimeMillis()))
                    }
                }.start()
            }
            button("Load 3 s", R.id.cpu_load) {
                Thread {
                    val end = android.os.SystemClock.uptimeMillis() + 3_000
                    var x = 0L
                    // the clock is read rarely: the time goes to this loop, not to the clock
                    while (android.os.SystemClock.uptimeMillis() < end) repeat(100_000) { x += x xor 7 }
                    if (x == 42L) println(x)
                }.start()
            }
            val taps = label("Taps: 0", R.id.cpu_taps)
            var count = 0
            button("Stall", R.id.cpu_stall) {
                costMs("stall_ms")?.let(::knownCost)
                costMs("sleep_ms")?.let(Thread::sleep)
                taps.text = "Taps: ${++count}"
            }
        }
    }
}
