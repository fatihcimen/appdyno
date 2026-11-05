package dev.appdyno.agent

import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONObject

/** What an answer waits for and what it reads: the app quiet, a screen there, the settle after an action. On the one action thread. */
class Settling(private val automation: Automation, private val capture: TreeCapture) {
    private val transitions = Transitions(automation)
    private val settler = Settler({ SystemClock.uptimeMillis() }, { automation.awaitEvent(it) }, { automation.lastEventAt })

    /**
     * Before a read: the app quiet, as the platform tells it (no layout-moving accessibility event for
     * IDLE_QUIET_MS, at most IDLE_MAX_MS); an app already quiet is read at once. Whether it went quiet.
     */
    fun idle(job: Job): Boolean {
        val end = SystemClock.uptimeMillis() + IDLE_MAX_MS
        while (!job.cancelled && SystemClock.uptimeMillis() < end) {
            val quiet = SystemClock.uptimeMillis() - automation.lastEventAt
            if (quiet >= IDLE_QUIET_MS) return true
            Thread.sleep(IDLE_QUIET_MS - quiet)
        }
        return SystemClock.uptimeMillis() - automation.lastEventAt >= IDLE_QUIET_MS
    }

    /** The settle and the read an action asked for, into its result. `then`: the app's windows before it. */
    fun after(r: AfterRequest, at: Long, job: Job, out: JSONObject, windowsBefore: Set<Int>, inert: Boolean = false): Reply {
        var last: Capture? = null
        if (r.settle != null) {
            val quiet = r.settle.quietMs.let { if (inert) minOf(it, INERT_QUIET_MS) else it }
            var asked = false
            val before = r.before?.let { recent[it] }
            var then = windowsBefore
            val o = settler.run(
                at,
                quiet,
                r.settle.maxMs,
                before,
                {
                    asked = false
                    readSettling().also {
                        last = it
                        // the list of windows can lag a screen just opened: what still shows the old layout is the old window
                        if (before != null && it.sameLayout(before)) then = WindowIds.app(it.windows.map { w -> w.id to w.type })
                    }
                },
                { x, y -> x.sameLayout(y) },
                { it.busy },
                { job.cancelled },
                { it.nodes.size },
                { hold(then, last, !asked).also { asked = true } },
                { c -> WindowIds.replaced(WindowIds.app(c.windows.map { w -> w.id to w.type }), appWindows()) },
            )
            out.put("settle", Results.settle(o, last?.sliding == true || transitions.runningNow()))
        }
        if (r.read != "none") {
            val c = last?.takeUnless { it.noApp } ?: aScreen(job) { capture.capture() }
            if (r.read == "tree") out.put("tree", treeJson(c)) else if (r.read == "hash") out.put("hash", c.also { recent[it.hash] = it }.hash)
        }
        return Reply(out)
    }

    /** A read in a settle: no window at all (between two screens) is a screen with nothing on it, not a failure. */
    private fun readSettling(): Capture = try {
        capture.capture()
    } catch (_: AgentFailure) {
        Capture(emptyList(), emptyList(), false, 0, Platform.display())
    }

    /**
     * A read to answer with: never the status bar alone, as between two screens there is nothing else for up to
     * 500 ms, and "no elements" would be a false answer. Waits for a screen on a display that is on; else NOT_FOUND.
     */
    fun aScreen(job: Job, read: () -> Capture): Capture {
        val end = SystemClock.uptimeMillis() + NO_SCREEN_MS
        while (true) {
            val c = try {
                read()
            } catch (e: AgentFailure) {
                if (e.code != "NOT_FOUND") throw e
                null
            }
            if (c != null && !c.noApp) return c
            if (job.cancelled || !Platform.display().on || SystemClock.uptimeMillis() >= end) {
                throw noWindow(Platform.display().on)
            }
            automation.awaitEvent(Settler.POLL_MS)
        }
    }

    fun appWindows() = WindowIds.app(automation.ua.windows.map { it.id to it.type })

    /**
     * Nothing worth reading now (no call to the app): between two screens; a window off the display on a release
     * with no resting places; a window transition still before its new window, where the old window read again
     * says nothing, or whose last read had no resting places. One question to WMS per read.
     */
    private fun hold(then: Set<Int>, last: Capture?, ask: Boolean): Boolean {
        val windows = try {
            automation.ua.windows
        } catch (_: Throwable) {
            emptyList()
        }
        val d = Platform.display()
        val b = android.graphics.Rect()
        var screen = false
        for (w in windows) {
            w.getBoundsInScreen(b)
            if (Slide.hasScreen(w.type, b.left, b.top, b.right, b.bottom, d)) screen = true
            // no resting places on this release: a window off the display has nothing final to read
            if (Build.VERSION.SDK_INT < 34 && w.type == AccessibilityWindowInfo.TYPE_APPLICATION && Slide.outside(b.left, b.top, b.right, b.bottom, d)) return true
        }
        if (!screen) return true
        // a new window with known resting places reads at once whatever the answer; it only says whether it is `moving`
        val newWindow = WindowIds.app(windows.map { it.id to it.type }) != then && last?.restUnknown != true
        if (newWindow) {
            if (ask) transitions.ask()
            return false
        }
        return transitions.running(ask)
    }

    /**
     * An action or a picture waits for a running transition: a touch in one can reach the old window or none
     * (the first tap after a start was lost so), and WMS's answer brings the input windows up to date too.
     */
    fun awaitRest() = transitions.awaitEnd(SLIDE_MAX_MS)

    /** The captures sent lately, by digest: a caller's `before` is compared with the layout itself. */
    private val recent = object : LinkedHashMap<String, Capture>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Capture>?) = size > 8
    }

    fun treeJson(c: Capture): JSONObject {
        recent[c.hash] = c
        return Results.tree(c)
    }

    /** The capture a caller's `before` names, if it was sent lately. */
    fun sent(hash: String?) = hash?.let { recent[it] }

    companion object {
        /** The quiet window after a tap on something that cannot react (an immediate touch reaction still shows). */
        const val INERT_QUIET_MS = 80L
        /** A read to answer with waits this long for a screen. */
        const val NO_SCREEN_MS = 2_000L
        /** WMS's own cap on a transition's wait. */
        const val SLIDE_MAX_MS = 5_000L
        /** A read waits for this long without a layout-moving event (an app already quiet: no wait). */
        const val IDLE_QUIET_MS = 150L
        const val IDLE_MAX_MS = 1_000L
    }
}
