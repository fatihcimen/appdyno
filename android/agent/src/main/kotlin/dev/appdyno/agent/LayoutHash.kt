package dev.appdyno.agent

/** One captured node, the agent's own copy (the framework node is never kept after the walk). */
class CNode(
    val parent: Int,
    val window: Int,
    val cls: String,
    val id: String?,
    val text: String?,
    val desc: String?,
    val hint: String?,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val flags: Int,
)

object Flags {
    const val VISIBLE = 1
    const val CLICKABLE = 2
    const val FOCUSABLE = 4
    const val FOCUSED = 8
    const val ENABLED = 16
    const val CHECKED = 32
    const val SELECTED = 64
    const val EDITABLE = 128
    const val SCROLLABLE = 256
    const val PASSWORD = 512
    const val CHECKABLE = 1024
    const val LONG_CLICKABLE = 2048
}

/**
 * The layout digest of a capture: class, id and bounds of every visible node, texts left out (a
 * countdown or a carousel caption keeps changing on a settled screen). A plain text node keeps only its
 * vertical place: its width follows its text, which is not a layout change.
 */
object LayoutHash {
    fun of(nodes: List<CNode>): String {
        var h = -0x340d631b7bdddcdbL // FNV-1a 64 offset basis
        fun mix(s: String) {
            for (ch in s) {
                h = h xor ch.code.toLong()
                h *= 0x100000001b3L
            }
        }
        for (n in nodes) {
            if (n.flags and Flags.VISIBLE == 0) continue
            mix(n.cls)
            mix("#")
            mix(n.id ?: "")
            val interactive = n.flags and (Flags.CLICKABLE or Flags.EDITABLE or Flags.CHECKABLE or Flags.SCROLLABLE) != 0
            val plainText = !interactive && !n.text.isNullOrEmpty()
            mix(if (plainText) "@${n.top},${n.bottom}" else "@${n.left},${n.top},${n.right},${n.bottom}")
            mix(";")
        }
        return java.lang.Long.toHexString(h)
    }
}
