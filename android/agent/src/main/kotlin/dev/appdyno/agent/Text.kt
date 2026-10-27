package dev.appdyno.agent

import android.content.ClipData
import android.os.Bundle
import android.os.SystemClock
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

class TextOutcome(val mode: String, val verified: Boolean, val focusMs: Long)

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
            // whatever has the keyboard, as a person's would; the text cannot be read back
            if (keyboardShown() && TextPlan.isAscii(text) && input.typeKeys(text)) return TextOutcome("keys", false, focusMs)
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
            if (input.typeKeys(text)) return TextOutcome("keys", false, focusMs)
        }
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, target)
        }
        if (!TextPlan.keysOnly(field.maxTextLength, text) &&
            field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) && check(field, target, password)
        ) {
            return TextOutcome("setText", !password, focusMs)
        }
        // paste: the field's own input path (formatters, filters) sees the text
        clipboard.set(if (replace) target else text)
        if (replace) select(field, 0, (field.text ?: "").length) else select(field, (field.text ?: "").length, (field.text ?: "").length)
        if (field.performAction(AccessibilityNodeInfo.ACTION_PASTE) && check(field, target, password)) {
            return TextOutcome("paste", !password, focusMs)
        }
        if (TextPlan.isAscii(text)) {
            if (replace) {
                select(field, 0, (field.text ?: "").length)
                input.key(android.view.KeyEvent.KEYCODE_DEL)
            }
            if (input.typeKeys(text)) return TextOutcome("keys", check(field, target, password), focusMs)
        }
        throw AgentFailure("INTERNAL", "the field did not take the text", "read the screen; the field may be read-only")
    }

    /** An input method window is on screen (the keyboard is up). */
    private fun keyboardShown(): Boolean =
        automation.ua.windows.any { it.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_INPUT_METHOD }

    private fun check(field: AccessibilityNodeInfo, target: String, password: Boolean): Boolean {
        if (password) return true // a password field reports no readable text
        repeat(3) {
            field.refresh()
            if (TextPlan.matches(field.text?.toString(), target)) return true
            Thread.sleep(30)
        }
        return false
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
            for (c in 0 until n.childCount) n.getChild(c)?.let { nodes.add(it); parents.add(i) }
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

    /** The focused editable node of the active window, searched breadth-first (bounded). */
    private fun focusedField(): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        automation.ua.rootInActiveWindow?.let { queue.add(it) }
        var seen = 0
        while (queue.isNotEmpty() && seen++ < 3_000) {
            val n = queue.removeFirst()
            if (n.isFocused && n.isEditable) return n
            for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    private fun waitFocus(deadline: Long, cancelled: () -> Boolean): AccessibilityNodeInfo? {
        var polls = 0
        while (!cancelled()) {
            // the cached answer may predate the tap's focus change
            if (polls++ % 3 == 0) automation.clearCache()
            val f = automation.ua.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (f != null && f.isEditable) return f
            // a toolkit that draws its own fields (Compose) reports the host view as the input focus
            focusedField()?.let { return it }
            if (SystemClock.uptimeMillis() >= deadline) return null
            Thread.sleep(40)
        }
        return null
    }
}
