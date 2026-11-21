package dev.appdyno.agent

import android.content.ClipData
import android.graphics.Rect
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

    /**
     * Whether text may go by a paste, by `isSet` of a system property: never on an emulator, whose clipboard service
     * syncs the clipboard with the computer's, a person's, where `ro.boot.qemu` is set (`ro.kernel.qemu` on older
     * releases), nor where they cannot be read.
     */
    fun pastes(isSet: (String) -> Boolean) = runCatching { listOf("ro.boot.qemu", "ro.kernel.qemu").none(isSet) }.getOrDefault(false)

    /** Enter goes after the text when asked, but never after a read-back that says the field holds other text: a search or a form would act on it. */
    fun submits(asked: Boolean, verified: Boolean?) = asked && verified != false
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

    /** How long an editor the app draws must hold the focus before it is typed into: a tapped field tells its focus later. */
    const val DRAWN_MS = 500L

    /**
     * One look of the wait: `field`, the field with the focus, where it is one `meant`; else, where no field has it,
     * `drawn`, an editor the app draws with the focus (Saber's page, Flutter's rich text), once `steady` has seen it
     * `DRAWN_MS`. Never while a field has the focus, as the field typed before still has it after a tap in Chrome.
     */
    fun <F : Any> look(field: F?, meant: (F) -> Boolean, drawn: () -> F?, steady: Steady<F>, now: Long): F? = if (field != null) field.takeIf(meant).also { steady.of(now, null) } else steady.of(now, drawn())

    /** What a look finds, once it has found it at each look for `holdMs`. */
    class Steady<F : Any>(private val holdMs: Long) {
        private var seen: F? = null
        private var since = 0L

        fun of(now: Long, found: F?): F? {
            if (found != seen) since = now
            seen = found
            return found?.takeIf { now - since >= holdMs }
        }
    }
}

/** `verified`: the field read back holds the text (null: it cannot be read back, a password or no field). */
class TextOutcome(val mode: String, val verified: Boolean?, val focusMs: Long)

/** Which editable node a point means (pure, unit tested): boxes are left, top, right, bottom. */
object EditablePick {
    /** The most times a holder's area may be its field's and still be that field's own: a text-input layout is 2 to 3. */
    const val HOLDER_AREA = 8

    /** `control`: the element takes a touch of its own (clickable). */
    fun under(boxes: List<IntArray>, parents: List<Int>, editable: List<Boolean>, control: List<Boolean>, x: Int, y: Int): Int? {
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
        // the smallest element under the point that holds fields: its only one, where that element is the field's own,
        // never a guess among several. Not past a control the point is on, which the touch meant, nor up to a screen or a
        // page that holds one field elsewhere (Saber's note, 44 times its title, whose text went into the title)
        for (c in boxes.indices.filter { inside(it) }.sortedBy { area(it) }) {
            val held = fields.filter { under(it, c) }
            if (held.isEmpty()) {
                if (control[c]) return null
                continue
            }
            return held.singleOrNull()?.takeIf { area(c) <= HOLDER_AREA * area(it) }
        }
        return null
    }
}

/** The field a typing at a tapped point goes into, through the waits of `TextInput.set` (pure, unit tested). */
object TapFocus {
    /**
     * The field with the focus, waited for (`wait`) until a third of `timeoutMs` from `start`; then the field at the point,
     * `pick`, asked for it (`focus`) and waited for until two thirds; then the point tapped again (`retap`) and waited for
     * to the end. `old`, the field that had the focus before the tap where the tap was not on it, is passed over: still
     * focused after the tap, it is a focus the app has not moved yet (Chrome tells a new one late), and the text would go
     * into the field typed before. It is meant only where `pick` names it, as a layout's helper text names its field.
     */
    fun <F : Any> field(
        old: F?,
        start: Long,
        timeoutMs: Long,
        wait: (deadline: Long, meant: (F) -> Boolean) -> F?,
        pick: () -> F?,
        focus: (F) -> Unit,
        retap: () -> Unit,
    ): F? {
        val meant = { f: F -> f != old }
        wait(start + timeoutMs / 3, meant)?.let { return it }
        val p = pick()
        if (p != null && p == old) return p
        p?.let(focus)
        wait(start + timeoutMs * 2 / 3, meant)?.let { return it }
        retap()
        return wait(start + timeoutMs, meant)
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
 * pasted, but on an emulator, and plain ASCII still left over is typed as key events.
 */
class TextInput(private val automation: Automation, private val input: Input, private val clipboard: Clipboard) {
    private val pastes by lazy { TextPlan.pastes(Platform::propertySet) }

    /**
     * `at`: the point to tap first, and type into the field it focuses. When no field takes the focus from the tap (a
     * container such as a Material text-input layout whose middle is not its text field, a tap lost while the screen
     * moved), the one editable field under that point is focused through accessibility, then the point is tapped again
     * (TapFocus).
     */
    fun set(text: String, replace: Boolean, focusTimeoutMs: Long, cancelled: () -> Boolean, at: Pair<Float, Float>? = null): TextOutcome {
        // by its box before the tap: the page may move up for the keyboard after it
        val old = at?.let { (x, y) -> focused()?.takeUnless { f -> Rect().also(f::getBoundsInScreen).contains(x.toInt(), y.toInt()) } }
        val tap = { at?.let { (x, y) -> input.tap(x, y, cancelled) } }
        tap()
        val start = SystemClock.uptimeMillis()
        val field = if (at == null) {
            waitFocus(start + focusTimeoutMs, cancelled, null) { true }
        } else {
            TapFocus.field(
                old,
                start,
                focusTimeoutMs,
                { deadline, meant -> waitFocus(deadline, cancelled, at, meant) },
                { editableAt(at.first, at.second) },
                { f ->
                    f.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                    f.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                },
                { tap() },
            )
        }
        val focusMs = SystemClock.uptimeMillis() - start
        if (field != null && !field.isEditable) {
            // an editor the app draws takes keys, as a person's; it is never cleared, and nothing is read back
            if (replace) throw AgentFailure("UNSUPPORTED", "the focus is on an editor the app draws, not a field: what it holds cannot be replaced from here", "type without replace")
            if (TextPlan.isAscii(text) && input.typeKeys(text)) return TextOutcome("keys", null, focusMs)
            throw AgentFailure("UNSUPPORTED", "the focus is on an editor the app draws, not a field: it takes plain keys only, ASCII letters, digits and signs", "type the text in plain ASCII")
        }
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
        // paste: the field's own input path (formatters, filters) sees the text. Never on an emulator (`TextPlan.pastes`):
        // its clipboard is the computer's too, a person's, and a password would land there
        if (pastes) clipboard.set(if (replace) target else text)
        if (pastes && attempt("paste") {
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
        val why = if (pastes) "" else ", and on an emulator no text goes by a paste, as its clipboard is the computer's too"
        throw AgentFailure("INTERNAL", "the field did not take the text$why", "read the screen; the field may be read-only")
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
     * element under it that has any (a text-input layout around its field). None when that is ambiguous, or the
     * point is on another control or far from the field (EditablePick).
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
        val boxes = nodes.map { n -> Rect().also { n.getBoundsInScreen(it) } }
        val pick = EditablePick.under(
            boxes.map { intArrayOf(it.left, it.top, it.right, it.bottom) },
            parents,
            nodes.map { it.isEditable && it.isVisibleToUser },
            nodes.map { it.isClickable },
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

    /** The field with the focus, once it is one `meant`, else an editor the app draws at `at` (FocusWait.look). */
    private fun waitFocus(deadline: Long, cancelled: () -> Boolean, at: Pair<Float, Float>?, meant: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        val steady = FocusWait.Steady<AccessibilityNodeInfo>(FocusWait.DRAWN_MS)
        // no field at the point, as the tree under it says: asked once, where an editor the app draws has the focus
        val noField by lazy { at == null || editableAt(at.first, at.second) == null }
        return FocusWait.until(deadline, cancelled, SystemClock::uptimeMillis, Thread::sleep) { polls ->
            // the cached answer may predate the tap's focus change
            if (polls % 3 == 0) automation.clearCache()
            FocusWait.look(focused(), meant, { drawnEditor(at)?.takeIf { noField } }, steady, SystemClock.uptimeMillis())
        }
    }

    /**
     * What has the input focus where no field has it, with the keyboard up: an editor the app draws, as Flutter's rich
     * text, which keys reach as a person's do. Where a point is given, one that holds it.
     */
    private fun drawnEditor(at: Pair<Float, Float>?): AccessibilityNodeInfo? {
        if (!keyboardShown()) return null
        val f = automation.ua.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeUnless { it.isEditable } ?: return null
        return f.takeIf { at == null || Rect().also(f::getBoundsInScreen).contains(at.first.toInt(), at.second.toInt()) }
    }

    private fun focused(): AccessibilityNodeInfo? = automation.ua.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }
        // a toolkit that draws its own fields (Compose) reports the host view as the input focus, and a sheet that just
        // opened is a window of its own: the focused editable node of any window
        ?: editables().firstOrNull { it.isFocused }

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
