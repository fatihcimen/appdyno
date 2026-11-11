package dev.appdyno.agent

import android.app.UiAutomation
import android.os.SystemClock
import java.lang.reflect.Method
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Whether a window transition runs, from WMS itself: `syncInputTransactions(true)` (hidden, by reflection) returns
 * when nothing animates and no transition is running, 5 s at most, and never calls the app. It returns at once
 * if the transition has not started, and it cannot see animations inside the app. Where the release lacks it
 * (API 30 and below) none is ever reported. The call blocks, so it runs on a thread of its own; its return wakes
 * the settle's sleep.
 */
class Transitions(private val automation: Automation) {
    private val method: Method? = try {
        UiAutomation::class.java.getDeclaredMethod("syncInputTransactions", Boolean::class.javaPrimitiveType).apply { isAccessible = true }
    } catch (_: Throwable) {
        null
    }

    private var question: CountDownLatch? = null
    private var askedAt = 0L

    /** The last question is still unanswered: a transition runs. */
    val open: Boolean get() = (question?.count ?: 0L) > 0

    /** Asks WMS unless the last question is still out; the answer comes on its own. */
    fun ask(): CountDownLatch? {
        if (open) return question
        val m = method ?: return null
        val done = CountDownLatch(1)
        question = done
        askedAt = SystemClock.uptimeMillis()
        Thread({
            try {
                m.invoke(automation.ua, true)
            } catch (_: Throwable) {
                // no answer from WMS: as if nothing ran
            } finally {
                done.countDown()
                automation.wake()
            }
        }, "appdyno-transition").apply { isDaemon = true }.start()
        return done
    }

    /**
     * Does one run? `again`: ask anew if nothing was running at the last question. An idle WMS answers within
     * ANSWER_MS; a slow one reads as running until it answers, which delays a read and no more.
     */
    fun running(again: Boolean): Boolean {
        if (open) return true
        if (!again) return false
        return ask()?.await(ANSWER_MS, TimeUnit.MILLISECONDS) == false
    }

    /**
     * For an answer's `moving`: the question is out for longer than an idle WMS takes, up to the time left of that.
     * An answer comes right after a read that asked, so a question merely not back yet says nothing.
     */
    fun runningNow(): Boolean {
        val q = question ?: return false
        val left = askedAt + IDLE_ANSWER_MS - SystemClock.uptimeMillis()
        if (left > 0) q.await(left, TimeUnit.MILLISECONDS)
        return q.count > 0
    }

    /** Until the running one ended, at most `maxMs`. */
    fun awaitEnd(maxMs: Long) {
        ask()?.await(maxMs, TimeUnit.MILLISECONDS)
    }

    private companion object {
        const val ANSWER_MS = 30L
        const val IDLE_ANSWER_MS = 80L
    }
}
