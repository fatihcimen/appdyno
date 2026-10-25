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

private const val TYPE_IME = 2
private const val TYPE_SYSTEM = 3
private const val TYPE_OVERLAY = 4
private const val SYSTEM_UI = "com.android.systemui"

class Capture(
    val windows: List<CWindow>,
    val nodes: List<CNode>,
    val truncated: Boolean,
    val elapsedMs: Long,
    private val display: DisplayInfo,
) {
    /** The digest of the app's and the system dialogs' windows (status bar, keyboard and overlays left out). */
    val hash: String by lazy { LayoutHash.of(appNodes) }

    /** The nodes of the app's and the system dialogs' windows. */
    val appNodes: List<CNode> by lazy {
        nodes.filter { n ->
            windows[n.window].let { it.type != TYPE_IME && it.type != TYPE_OVERLAY && !(it.type == TYPE_SYSTEM && it.pkg == SYSTEM_UI) }
        }
    }

    fun sameLayout(other: Capture) = LayoutHash.same(appNodes, other.appNodes)

    /**
     * The screen is not done: a progress indicator shows (a spinner, a loading bar), or an app window
     * sticks out of the display (a window sliding in or out: its reported place stays at a midway point
     * until the animation ends).
     */
    val busy: Boolean by lazy {
        nodes.any { it.flags and Flags.VISIBLE != 0 && it.cls.endsWith("ProgressBar") } ||
            windows.any { w ->
                w.type == AccessibilityWindowInfo.TYPE_APPLICATION &&
                    (w.bounds.left < 0 || w.bounds.top < 0 || w.bounds.right > display.width || w.bounds.bottom > display.height)
            }
    }
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

    @Volatile
    private var failedReads = 0

    fun capture(maxDepth: Int = 128, maxNodes: Int = 5_000, budgetMs: Long = 8_000): Capture {
        val start = SystemClock.uptimeMillis()
        val ua = automation.ua
        automation.clearCache()
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

        failedReads = 0
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
        return Capture(windows, nodes, truncated || failedReads > 0, SystemClock.uptimeMillis() - start, Platform.display())
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
        // a node the app cannot give (a web view rebuilding its virtual tree) is left out, not fatal
        val read: (Want) -> AccessibilityNodeInfo? = { w ->
            try {
                if (Build.VERSION.SDK_INT >= 33) w.node.getChild(w.child, PREFETCH) else w.node.getChild(w.child)
            } catch (_: RuntimeException) {
                failedReads++
                null
            }
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
