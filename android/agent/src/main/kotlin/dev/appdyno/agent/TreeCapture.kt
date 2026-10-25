package dev.appdyno.agent

import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CWindow(
    val type: Int,
    val pkg: String?,
    val layer: Int,
    val bounds: Rect,
    val active: Boolean,
    val focused: Boolean,
)

class Capture(val windows: List<CWindow>, val nodes: List<CNode>, val truncated: Boolean, val elapsedMs: Long) {
    val hash: String by lazy { LayoutHash.of(nodes) }
}

/**
 * Reads every interactive window's tree. Each node read that misses the client cache is a call the app
 * answers on its UI thread; a busy app interrupts the default prefetch after almost every node, so the
 * walk asks for uninterruptible breadth-first prefetch (one call returns a node and its next descendants)
 * and reads the children of a tree level in parallel. The cache is cleared first: an in-place screen swap
 * does not always invalidate it.
 */
class TreeCapture(private val automation: Automation) {
    private val pool: ExecutorService = Executors.newFixedThreadPool(PARALLEL) { r ->
        Thread(r, "appdyno-tree").apply { isDaemon = true }
    }

    fun capture(maxDepth: Int = 128, maxNodes: Int = 5_000, budgetMs: Long = 8_000): Capture {
        val start = SystemClock.uptimeMillis()
        val ua = automation.ua
        if (Build.VERSION.SDK_INT >= 34) ua.clearCache() else ua.serviceInfo = ua.serviceInfo
        val windows = mutableListOf<CWindow>()
        val roots = mutableListOf<Pair<AccessibilityNodeInfo, Int>>()
        val list: List<AccessibilityWindowInfo> = try {
            ua.windows.sortedBy { it.layer }
        } catch (_: Throwable) {
            emptyList()
        }
        for (w in list) {
            val root = (if (Build.VERSION.SDK_INT >= 33) w.getRoot(PREFETCH) else w.root) ?: continue
            val b = Rect().also { w.getBoundsInScreen(it) }
            windows += CWindow(w.type, root.packageName?.toString(), w.layer, b, w.isActive, w.isFocused)
            roots += root to windows.size - 1
        }
        if (roots.isEmpty()) {
            val root = ua.rootInActiveWindow
                ?: throw AgentFailure("NOT_FOUND", "no window to read (screen off or locked?)")
            val b = Rect().also { root.getBoundsInScreen(it) }
            windows += CWindow(AccessibilityWindowInfo.TYPE_APPLICATION, root.packageName?.toString(), 0, b, true, true)
            roots += root to 0
        }

        val nodes = ArrayList<CNode>(512)
        var truncated = false
        var level: List<Triple<AccessibilityNodeInfo, Int, Int>> = roots.map { (n, w) -> Triple(n, -1, w) }
        var depth = 0
        while (level.isNotEmpty()) {
            val indices = IntArray(level.size)
            for ((i, item) in level.withIndex()) {
                if (nodes.size >= maxNodes) {
                    truncated = true
                    break
                }
                indices[i] = nodes.size
                nodes += copy(item.first, item.second, item.third)
            }
            if (truncated || ++depth >= maxDepth || SystemClock.uptimeMillis() - start > budgetMs) {
                truncated = truncated || level.any { it.first.childCount > 0 }
                break
            }
            level = children(level, indices)
        }
        return Capture(windows, nodes, truncated, SystemClock.uptimeMillis() - start)
    }

    private class Want(val node: AccessibilityNodeInfo, val child: Int, val parent: Int, val window: Int)

    private fun children(
        level: List<Triple<AccessibilityNodeInfo, Int, Int>>,
        indices: IntArray,
    ): List<Triple<AccessibilityNodeInfo, Int, Int>> {
        val wanted = ArrayList<Want>()
        for ((i, item) in level.withIndex()) {
            for (c in 0 until item.first.childCount) wanted += Want(item.first, c, indices[i], item.third)
        }
        val read: (Want) -> AccessibilityNodeInfo? = { w ->
            if (Build.VERSION.SDK_INT >= 33) w.node.getChild(w.child, PREFETCH) else w.node.getChild(w.child)
        }
        val got: List<AccessibilityNodeInfo?> = if (wanted.size <= PARALLEL) {
            wanted.map(read)
        } else {
            pool.invokeAll(wanted.map { Callable { read(it) } }).map { it.get() }
        }
        val out = ArrayList<Triple<AccessibilityNodeInfo, Int, Int>>(got.size)
        for ((i, child) in got.withIndex()) {
            if (child != null) out += Triple(child, wanted[i].parent, wanted[i].window)
        }
        return out
    }

    private fun copy(n: AccessibilityNodeInfo, parent: Int, window: Int): CNode {
        val r = Rect().also { n.getBoundsInScreen(it) }
        var f = 0
        if (n.isVisibleToUser) f = f or Flags.VISIBLE
        if (n.isClickable) f = f or Flags.CLICKABLE
        if (n.isLongClickable) f = f or Flags.LONG_CLICKABLE
        if (n.isFocusable) f = f or Flags.FOCUSABLE
        if (n.isFocused) f = f or Flags.FOCUSED
        if (n.isEnabled) f = f or Flags.ENABLED
        if (n.isChecked) f = f or Flags.CHECKED
        if (n.isCheckable) f = f or Flags.CHECKABLE
        if (n.isSelected) f = f or Flags.SELECTED
        if (n.isEditable) f = f or Flags.EDITABLE
        if (n.isScrollable) f = f or Flags.SCROLLABLE
        if (n.isPassword) f = f or Flags.PASSWORD
        val hint = n.hintText?.toString()
        // a field showing its hint reports the hint as its text: it has no text of its own
        val text = if (n.isShowingHintText) null else n.text?.toString()
        return CNode(
            parent, window, n.className?.toString() ?: "", n.viewIdResourceName, text,
            n.contentDescription?.toString(), hint, r.left, r.top, r.right, r.bottom, f,
        )
    }

    companion object {
        const val PARALLEL = 8
        private const val PREFETCH =
            AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_BREADTH_FIRST or
                AccessibilityNodeInfo.FLAG_PREFETCH_UNINTERRUPTIBLE
    }
}
