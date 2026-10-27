package dev.appdyno.agent

import android.graphics.RectF
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Text a screen does not show whole, from the platform's character locations of a text node (one call to
 * the app per node). A character is hidden when it has no visible place (cut by its frame, a line past the
 * last one shown), no width, or the very place of an earlier character on its line (an ellipsis replaced
 * it: the characters after it collapse onto one point). Spaces and format characters never count.
 */
object TextClip {
    /** At most this many characters of a text are located. */
    const val MAX_CHARS = 500

    /** Hidden characters of `text`, given each located character's [left, top, right, bottom] (null: not shown). */
    fun hidden(text: CharSequence, boxes: List<FloatArray?>): Int {
        var n = 0
        val places = HashSet<Long>()
        for (i in boxes.indices) {
            if (i >= text.length) break
            val c = text[i]
            if (Character.isWhitespace(c) || Character.getType(c) == Character.FORMAT.toInt()) continue
            val b = boxes[i]
            if (b == null || b[2] - b[0] < 0.5f) {
                n++
                continue
            }
            val place = (Math.round(b[0]).toLong() shl 32) or (Math.round(b[1]).toLong() and 0xffffffffL)
            if (!places.add(place)) n++
        }
        return n
    }

    /** Characters located and hidden of one node; null where the app gives no character locations. */
    fun of(n: AccessibilityNodeInfo): Pair<Int, Int>? {
        val text = n.text ?: return null
        val key = AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY
        if (text.isEmpty() || !n.availableExtraData.contains(key)) return null
        val len = minOf(text.length, MAX_CHARS)
        val args = Bundle().apply {
            putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX, 0)
            putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH, len)
        }
        val boxes = try {
            if (!n.refreshWithExtraData(key, args)) return null
            @Suppress("DEPRECATION")
            n.extras.getParcelableArray(key) ?: return null
        } catch (_: RuntimeException) {
            return null
        }
        return len to hidden(text, boxes.map { r -> (r as RectF?)?.let { floatArrayOf(it.left, it.top, it.right, it.bottom) } })
    }
}
