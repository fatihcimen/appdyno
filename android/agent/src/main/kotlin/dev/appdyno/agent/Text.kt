package dev.appdyno.agent

import android.content.ClipData
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo

/** What the field should hold after typing `text` (pure, unit tested). */
object TextPlan {
    fun target(current: String?, text: String, replace: Boolean): String = if (replace) text else (current ?: "") + text

    /**
     * A read-back equal to the target, after the field's own trimming of trailing line breaks, or with the
     * same letters and digits (a field that formats what is typed: "(599) 999-9900" for "5999999900").
     */
    fun matches(actual: String?, target: String): Boolean {
        val a = actual ?: ""
        if (a == target || a.trimEnd('\n') == target.trimEnd('\n')) return true
        val plain = { s: String -> s.filter { it.isLetterOrDigit() } }
        return plain(target).isNotEmpty() && plain(a) == plain(target)
    }

    fun isAscii(text: String) = text.all { it.code in 0x20..0x7e }

    /** A field limited to fewer characters than the text (`maxTextLength` -1: no limit) takes it key by key. */
    fun keysOnly(maxTextLength: Int, text: String) = maxTextLength in 1 until text.length
}

/** The wait for a field to take the focus (pure, unit tested). */
object FocusWait {
    /**
     * `look`, every 40 ms, until it finds the field; null once `deadline` passes. A device that stalled (a starved
     * emulator, an app that did not answer for seconds) spent the wait without looking: that time does not count (A/B
     * runs 3b9df4d5, 64985b2a: a 4 s stall ended it). A cancel ends it as CANCELLED: a wait that ended so is no field
     * that would not take the focus, which the caller makes up for with another tap or keys typed blind.
     */
    fun <T : Any> until(deadline: Long, cancelled: () -> Boolean, now: () -> Long, sleep: (Long) -> Unit, look: (polls: Int) -> T?): T? {
        var polls = 0
        var end = deadline
        var last = now()
        while (!cancelled()) {
            look(polls++)?.let { return it }
            val t = now()
            if (t - last > TextInput.STALL_MS) end = minOf(end + t - last, deadline + TextInput.MAX_STALL_MS)
            last = t
            if (t >= end) return null
            sleep(40)
        }
        throw AgentFailure("CANCELLED", "the host no longer waits for it")
    }
}

/** `verified`: the field read back holds the text (null: it cannot be read back, a password or no field). */
class TextOutcome(val mode: String, val verified: Boolean?, val focusMs: Long)

/** Which editable node a point means (pure, unit tested): boxes are left, top, right, bottom. */
object EditablePick {
    fun under(boxes: List<IntArray>, parents: List<Int>, editable: List<Boolean>, x: Int, y: Int): Int? {
        fun inside(i: Int) = boxes[i].let { x >= it[0] && x < it[2] && y >= it[1] && y < it[3] }
        fun area(i: Int) = boxes[i].let { (it[2] - it[0]).toLong() * (it[3] - it[1]) }
        fun under(i: Int, a: Int): Boolean {
            var p = parents[i]
            while (p >= 0) {
                if (p == a) return true
                p = parents[p]
            }
            return false
        }
        val fields = editable.indices.filter { editable[it] }
        fields.filter { inside(it) }.minByOrNull { area(it) }?.let { return it }
        // the smallest element under the point that holds fields: its only one, never a guess among several
        for (c in boxes.indices.filter { inside(it) }.sortedBy { area(it) }) {
            val held = fields.filter { under(it, c) }
            if (held.isEmpty()) continue
            return held.singleOrNull()
        }
        return null
    }
}

/** The device clipboard, read and written as the shell package (allowed in the background). */
class Clipboard {
    private val service: Any by lazy { Platform.asInterface("android.content.IClipboard\$Stub", Platform.service("clipboard")) }

    fun set(text: String) {
        Platform.callByTypes(service, "setPrimaryClip", ClipData.newPlainText("appdyno", text), SHELL)
    }

    fun get(): String? {
        val clip = Platform.callByTypes(service, "getPrimaryClip", SHELL) as ClipData? ?: return null
        return if (clip.itemCount > 0) clip.getItemAt(0).text?.toString() else null
    }

    companion object {
        const val SHELL = "com.android.shell"
    }
}

/**
 * Typing without a keyboard app: wait until an editable field has input focus (a slow phone focuses a
 * field well after the tap), set its text, read it back; a field that ignores the set gets the text
 * pasted, and plain ASCII still left over is typed as key events.
 */
class TextInput(private val automation: Automation, private val input: Input, private val clipboard: Clipboard) {
    /**
     * `at`: the point the caller tapped. When no field takes the focus from the tap (a container such as a
     * Material text-input layout whose middle is not its text field, a tap lost while the screen moved),
     * the one editable field under that point is focused through accessibility, then the point is tapped
     * again (`retap`).
     */
    fun set(
        text: String,
        replace: Boolean,
        focusTimeoutMs: Long,
        cancelled: () -> Boolean,
        retap: (() -> Unit)? = null,
        at: Pair<Float, Float>? = null,
    ): TextOutcome {
        val start = SystemClock.uptimeMillis()
        var field = if (at != null) waitFocus(start + focusTimeoutMs / 3, cancelled) else null
        if (field == null && at != null) {
            editableAt(at.first, at.second)?.let { f ->
                f.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                f.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
            field = waitFocus(start + focusTimeoutMs * 2 / 3, cancelled)
        }
        if (field == null) {
            retap?.invoke()
            field = waitFocus(start + focusTimeoutMs, cancelled)
        }
        val focusMs = SystemClock.uptimeMillis() - start
        if (field == null) {
            // no field reports the focus but the keyboard is up (a code entry drawn by the app): the keys go to
            // whatever has the keyboard, as a person's would; the text cannot be read back. Never while a field
            // is on screen: that one could be read back, and keys typed past it are lost unseen
            if (keyboardShown() && TextPlan.isAscii(text) && editables().isEmpty() && input.typeKeys(text)) {
                return TextOutcome("keys", null, focusMs)
            }
            throw AgentFailure("NO_FOCUS", "no editable field has input focus", "tap the field first")
        }
        val current = if (field.isShowingHintText) "" else field.text?.toString()
        val target = TextPlan.target(current, text, replace)
        val password = field.isPassword

        // a field that takes fewer characters than the text (one box of a code entry) moves on with each
        // key: set at once, the whole code would go into the first box (live: a refused login code)
        if (TextPlan.keysOnly(field.maxTextLength, text) && TextPlan.isAscii(text)) {
            if (replace) {
                select(field, 0, (field.text ?: "").length)
                input.key(android.view.KeyEvent.KEYCODE_DEL)
            }
            // one box takes one character: the whole text cannot be read back from the field
            if (input.typeKeys(text)) return TextOutcome("keys", null, focusMs)
        }
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, target)
        }
        val verdict: Boolean? = if (password) null else true
        val path = StringBuilder()

        // on a device that stalls (a starved emulator) an action's answer times out and the text still lands a
        // moment later: an accepted or slow action is read back with patience, and nothing that is already in
        // the field is cleared to try the next way
        fun attempt(way: String, action: () -> Boolean): Boolean {
            val t0 = SystemClock.uptimeMillis()
            val accepted = action()
            val slow = SystemClock.uptimeMillis() - t0 > SLOW_ACTION_MS
            val held = check(field, target, password, if (accepted || slow) CHECK_MS else 0)
            path.append("$way(accepted=$accepted slow=$slow held=$held) ")
            return held
        }
        fun done(mode: String, verified: Boolean?): TextOutcome {
            // the way it went in, never the text: what a stalled device did shows in its log
            Log.i(TAG, "typing ${target.length} chars into a field: $path-> $mode verified=$verified")
            return TextOutcome(mode, verified, focusMs)
        }
        if (!TextPlan.keysOnly(field.maxTextLength, text) &&
            attempt("setText") { field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) }
        ) {
            return done("setText", verdict)
        }
        // paste: the field's own input path (formatters, filters) sees the text
        clipboard.set(if (replace) target else text)
        if (attempt("paste") {
                if (replace) select(field, 0, (field.text ?: "").length) else select(field, (field.text ?: "").length, (field.text ?: "").length)
                field.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            }
        ) {
            return done("paste", verdict)
        }
        if (TextPlan.isAscii(text)) {
            if (replace) {
                select(field, 0, (field.text ?: "").length)
                input.key(android.view.KeyEvent.KEYCODE_DEL)
            }
            if (input.typeKeys(text)) {
                if (password || check(field, target, password, CHECK_MS)) return done("keys", verdict)
                // keys lost on their way (a keyboard app switching layouts on a stalled device): set once more
                if (attempt("setText again") { field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) }) return done("setText", true)
                return done("keys", false)
            }
        }
        Log.i(TAG, "typing ${target.length} chars into a field: $path-> not taken")
        throw AgentFailure("INTERNAL", "the field did not take the text", "read the screen; the field may be read-only")
    }

    /** An input method window is on screen (the keyboard is up). */
    private fun keyboardShown(): Boolean = automation.ua.windows.any { it.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_INPUT_METHOD }

    /** The field read back holds `target`, read until `waitMs` has passed (0: one read). */
    private fun check(field: AccessibilityNodeInfo, target: String, password: Boolean, waitMs: Long = 0): Boolean {
        if (password) return true // a password field reports no readable text
        val end = SystemClock.uptimeMillis() + waitMs
        while (true) {
            field.refresh()
            if (TextPlan.matches(field.text?.toString(), target)) return true
            if (SystemClock.uptimeMillis() >= end) return false
            Thread.sleep(CHECK_POLL_MS)
        }
    }

    private fun select(field: AccessibilityNodeInfo, from: Int, to: Int) {
        field.performAction(
            AccessibilityNodeInfo.ACTION_SET_SELECTION,
            Bundle().apply {
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, from)
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, to)
            },
        )
    }

    /**
     * The editable field the point means: the field under it, else the only field inside the smallest
     * element under it that has any (a text-input layout around its field). None when that is ambiguous.
     */
    private fun editableAt(x: Float, y: Float): AccessibilityNodeInfo? {
        val root = automation.ua.rootInActiveWindow ?: return null
        val nodes = ArrayList<AccessibilityNodeInfo>()
        val parents = ArrayList<Int>()
        nodes.add(root)
        parents.add(-1)
        var i = 0
        while (i < nodes.size && nodes.size < 3_000) {
            val n = nodes[i]
            for (c in 0 until n.childCount) {
                n.getChild(c)?.let {
                    nodes.add(it)
                    parents.add(i)
                }
            }
            i++
        }
        val boxes = nodes.map { n -> android.graphics.Rect().also { n.getBoundsInScreen(it) } }
        val pick = EditablePick.under(
            boxes.map { intArrayOf(it.left, it.top, it.right, it.bottom) },
            parents,
            nodes.map { it.isEditable && it.isVisibleToUser },
            x.toInt(),
            y.toInt(),
        )
        return pick?.let { nodes[it] }
    }

    /** Every window's root: a sheet or dialog that just opened has its own window, often not the active one. */
    private fun roots(): List<AccessibilityNodeInfo> {
        val all = try {
            automation.ua.windows.mapNotNull { it.root }
        } catch (_: Throwable) {
            emptyList()
        }
        return all.ifEmpty { listOfNotNull(automation.ua.rootInActiveWindow) }
    }

    /** The editable nodes on screen, the focused ones first. */
    private fun editables(): List<AccessibilityNodeInfo> {
        val out = ArrayList<AccessibilityNodeInfo>()
        val queue = ArrayDeque(roots())
        var seen = 0
        while (queue.isNotEmpty() && seen++ < 3_000) {
            val n = queue.removeFirst()
            if (n.isEditable && n.isVisibleToUser) out.add(n)
            for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
        }
        return out.sortedByDescending { it.isFocused }
    }

    private fun waitFocus(deadline: Long, cancelled: () -> Boolean): AccessibilityNodeInfo? = FocusWait.until(deadline, cancelled, SystemClock::uptimeMillis, Thread::sleep) { polls ->
        // the cached answer may predate the tap's focus change
        if (polls % 3 == 0) automation.clearCache()
        automation.ua.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }
            // a toolkit that draws its own fields (Compose) reports the host view as the input focus, and a sheet
            // that just opened is a window of its own: the focused editable node of any window
            ?: editables().firstOrNull { it.isFocused }
    }

    companion object {
        const val TAG = "appdyno"

        /** How long a read-back waits for an accepted (or slow) action's text to show in the field. */
        const val CHECK_MS = 1_000L
        const val CHECK_POLL_MS = 50L

        /** An action that took this long answered from a device that stalled: its text may land late. */
        const val SLOW_ACTION_MS = 1_000L

        /** A focus poll this far from the one before it: the device stalled between them. */
        const val STALL_MS = 1_000L

        /** The most a focus wait is stretched for stalls. */
        const val MAX_STALL_MS = 10_000L
    }
}
