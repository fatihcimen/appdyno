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
    const val NOT_IMPORTANT = 4096
    const val SCREEN_READER_FOCUSABLE = 8192
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
            if (!shown(n)) continue
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

    /** Visible with a non-empty box: a pager's scrolled-away page reports zero width and is not on the screen. */
    private fun shown(n: CNode) = n.flags and Flags.VISIBLE != 0 && n.right > n.left && n.bottom > n.top

    /** Moves up to this many pixels are no layout change (rounding, a jittering parent). */
    const val TOLERANCE = 8

    /**
     * The same layout: the same visible nodes (class, id) in the same order, each within TOLERANCE of its
     * place (a plain text node vertically only, as in the digest).
     */
    fun same(a: List<CNode>, b: List<CNode>): Boolean {
        val x = a.filter(::shown)
        val y = b.filter(::shown)
        if (x.size != y.size) return false
        for (i in x.indices) {
            val p = x[i]
            val q = y[i]
            if (p.cls != q.cls || p.id != q.id) return false
            fun near(u: Int, v: Int) = kotlin.math.abs(u - v) <= TOLERANCE
            if (!near(p.top, q.top) || !near(p.bottom, q.bottom)) return false
            val interactive = p.flags and (Flags.CLICKABLE or Flags.EDITABLE or Flags.CHECKABLE or Flags.SCROLLABLE) != 0
            val plainText = !interactive && !p.text.isNullOrEmpty()
            if (!plainText && (!near(p.left, q.left) || !near(p.right, q.right))) return false
        }
        return true
    }
}

/**
 * Can a tap at (x, y) start a reaction the screen does not show yet? Yes when any visible node there, or
 * an ancestor of one, is actionable (clickable, long-clickable, editable, checkable) or draws its own
 * content that takes touches (a web view, a map, a surface): a touch passes through a non-clickable
 * overlay to what lies below. No on plain text, images and empty space. Without a screen, always yes.
 */
object HitTest {
    private val DRAWS_OWN = Regex("WebView|SurfaceView|TextureView|MapView|GLSurfaceView", RegexOption.IGNORE_CASE)
    private const val ACTIONABLE = Flags.CLICKABLE or Flags.LONG_CLICKABLE or Flags.EDITABLE or Flags.CHECKABLE

    /** `nodes` is a whole capture (parents are its indices); `considered` says which windows' nodes count. */
    fun actionable(nodes: List<CNode>?, x: Int, y: Int, considered: (CNode) -> Boolean = { true }): Boolean {
        if (nodes == null) return true
        var hit = false
        for (n in nodes) {
            if (!considered(n) || n.flags and Flags.VISIBLE == 0 || n.right <= n.left || n.bottom <= n.top) continue
            if (x < n.left || x >= n.right || y < n.top || y >= n.bottom) continue
            hit = true
            var a: CNode? = n
            while (a != null) {
                if (a.flags and ACTIONABLE != 0 || DRAWS_OWN.containsMatchIn(a.cls)) return true
                a = if (a.parent >= 0) nodes[a.parent] else null
            }
        }
        return !hit // not on any node we know: be careful
    }
}
