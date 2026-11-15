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

    private val cycling = Cycling { SystemClock.uptimeMillis() }

    /** The read last answered with and when, and when the last action went out whose settle was not asked for or never came. */
    private var answered: Capture? = null
    private var answeredAt = 0L
    private var unsettledAt = 0L

    /** When an action last began, and whether what moved on the screen then moved by itself. */
    private var touchedAt = 0L
    private var byItself = false

    /**
     * Before an action: what the app's events tell of now is no doing of ours where no action went out within OWN_MS,
     * which a row our swipe threw is over in. Then a running transition is waited out.
     */
    fun beforeAction() {
        val now = SystemClock.uptimeMillis()
        byItself = now - automation.lastEventAt < IDLE_QUIET_MS && now - touchedAt > OWN_MS
        touchedAt = now
        awaitRest()
    }

    private fun screenArea() = Platform.display().let { it.width.toLong() * it.height }

    /**
     * A read to answer with, once the app is quiet. Where something on the screen is known to keep its events coming
     * they cannot say so, and a read does: one that shows the rest of the screen as the last answer had it is the
     * answer, at once. Not within ECHO_MS of an action no settle followed, whose effect the events are the first to tell of. `anyScreen`:
     * the status bar alone is an answer too.
     */
    fun read(job: Job, maxDepth: Int = 128, maxNodes: Int = 5_000, anyScreen: Boolean = false): Capture {
        val last = answered?.takeIf { SystemClock.uptimeMillis() - answeredAt <= Cycling.KEPT_MS }
        val area = screenArea()
        val busy = SystemClock.uptimeMillis() - automation.lastEventAt < IDLE_QUIET_MS
        if (last != null && busy && cycling.active && SystemClock.uptimeMillis() - unsettledAt > ECHO_MS) {
            val c = readSettling(maxDepth, maxNodes, yielding = true)
            if (!c.noApp && !c.busy && cycling.same(c.layout, last.layout, area, byItself = false)) {
                cycling.stillCycling()
                return c
            }
        }
        val quiet = idle(job)
        val take = { capture.capture(maxDepth, maxNodes, yielding = !quiet) }
        val c = if (anyScreen) take() else aScreen(job, take)
        // events of what an action of ours set moving name nothing
        if (!quiet && last != null && SystemClock.uptimeMillis() - touchedAt > OWN_MS + IDLE_MAX_MS) cycling.eventsKeptComing(c.layout, last.layout, area)
        return c
    }

    /** The settle and the read an action asked for, into its result. `then`: the app's windows before it. */
    fun after(r: AfterRequest, at: Long, job: Job, out: JSONObject, windowsBefore: Set<Int>, inert: Boolean = false): Reply {
        job.goOn()
        unsettledAt = at
        val area = screenArea()
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
                { x, y -> cycling.same(x.layout, y.layout, area, byItself) },
                { it.busy },
                { job.cancelled },
                { it.nodes.size },
                { hold(then, last, !asked).also { asked = true } },
                { c -> WindowIds.replaced(WindowIds.app(c.windows.map { w -> w.id to w.type }), appWindows()) },
            )
            out.put("settle", Results.settle(o, last?.sliding == true || transitions.runningNow()))
            // what the action did has been waited for
            if (o.settled) unsettledAt = 0
        }
        if (r.read != "none") {
            val c = last?.takeUnless { it.noApp } ?: aScreen(job) { capture.capture() }
            if (r.read == "tree") {
                out.put("tree", treeJson(c))
            } else if (r.read == "hash") {
                out.put("hash", keep(c))
            }
        }
        // as the screen answered with is: after the settle
        r.pidOf?.let { pkg -> AppProcess.of(pkg)?.let { out.put("pid", it) } }
        return Reply(out)
    }

    /** A read in a settle: no window at all (between two screens) is a screen with nothing on it, not a failure. */
    private fun readSettling(maxDepth: Int = 128, maxNodes: Int = 5_000, yielding: Boolean = false): Capture = try {
        capture.capture(maxDepth, maxNodes, yielding = yielding)
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
    private val recent = Lately<Capture>(8)

    /** Keeps an answer's capture by the digest it goes out with. */
    private fun keep(c: Capture): String {
        val hash = cycling.digest(c.layout) ?: c.hash
        recent[hash] = c
        answered = c
        answeredAt = SystemClock.uptimeMillis()
        return hash
    }

    fun treeJson(c: Capture): JSONObject = Results.tree(c, keep(c))

    /** The capture a caller's `before` names, if it was sent lately. */
    fun sent(hash: String?) = hash?.let { recent[it] }

    companion object {
        /** The quiet window after a tap on something that cannot react (an immediate touch reaction still shows). */
        const val INERT_QUIET_MS = 80L

        /** An action's effect shows in the app's events before any read has it: within this, they are waited for as ever. */
        const val ECHO_MS = 1_000L

        /** What an action of ours set moving, a row a swipe threw, is over within this: a settle's own cap. */
        const val OWN_MS = 3_000L

        /** A read to answer with waits this long for a screen. */
        const val NO_SCREEN_MS = 2_000L

        /** WMS's own cap on a transition's wait. */
        const val SLIDE_MAX_MS = 5_000L

        /** A read waits for this long without a layout-moving event (an app already quiet: no wait). */
        const val IDLE_QUIET_MS = 150L
        const val IDLE_MAX_MS = 1_000L
    }
}

/**
 * The last `keep` values, by key, the least lately used going first. Locked: a lane thread given up still reads and writes
 * it beside the new one until its next look at the job, and a read reorders it too.
 */
class Lately<V : Any>(private val keep: Int) {
    private val byKey = object : LinkedHashMap<String, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, V>?) = size > keep
    }

    @Synchronized
    operator fun get(key: String): V? = byKey[key]

    @Synchronized
    operator fun set(key: String, value: V) {
        byKey[key] = value
    }
}
