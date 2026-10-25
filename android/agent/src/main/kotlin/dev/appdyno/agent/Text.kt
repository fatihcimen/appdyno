package dev.appdyno.agent

import android.content.ClipData
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo

/** What the field should hold after typing `text` (pure, unit tested). */
object TextPlan {
    fun target(current: String?, text: String, replace: Boolean): String = if (replace) text else (current ?: "") + text

    /** A read-back equal to the target, after the field's own trimming of trailing line breaks. */
    fun matches(actual: String?, target: String): Boolean = (actual ?: "") == target || (actual ?: "").trimEnd('\n') == target.trimEnd('\n')

    fun isAscii(text: String) = text.all { it.code in 0x20..0x7e }
}

class TextOutcome(val mode: String, val verified: Boolean, val focusMs: Long)

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
    fun set(text: String, replace: Boolean, focusTimeoutMs: Long, cancelled: () -> Boolean): TextOutcome {
        val start = SystemClock.uptimeMillis()
        val field = waitFocus(start + focusTimeoutMs, cancelled)
            ?: throw AgentFailure("NO_FOCUS", "no editable field has input focus", "tap the field first")
        val focusMs = SystemClock.uptimeMillis() - start
        val current = if (field.isShowingHintText) "" else field.text?.toString()
        val target = TextPlan.target(current, text, replace)
        val password = field.isPassword

        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, target)
        }
        if (field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) && check(field, target, password)) {
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
