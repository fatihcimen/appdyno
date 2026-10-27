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
    /** The platform's window id (-1: not known): a new activity or dialog is a new window. */
    val id: Int,
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

    private fun appWindow(w: CWindow) = w.type != TYPE_IME && w.type != TYPE_OVERLAY && !(w.type == TYPE_SYSTEM && w.pkg == SYSTEM_UI)

    /** A node of the app's or a system dialog's window (not the status bar, the keyboard, an overlay). */
    fun inApp(n: CNode) = appWindow(windows[n.window])

    /** A point on a window that is not the app's (a key of the keyboard, the status bar). */
    fun onOtherWindow(x: Int, y: Int) = windows.any { !appWindow(it) && it.bounds.contains(x, y) }

    /** The nodes of the app's and the system dialogs' windows. */
    val appNodes: List<CNode> by lazy { nodes.filter(::inApp) }

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
 * and reads the children of a tree level in parallel (a read of an app that would not go quiet yields to it
 * instead). The cache is cleared first: an in-place screen swap does not always invalidate it.
 */
class TreeCapture(private val automation: Automation) {
    private val pool: ExecutorService = Executors.newFixedThreadPool(PARALLEL) { r ->
        Thread(r, "appdyno-tree").apply { isDaemon = true }
    }

    @Volatile
    private var failedReads = 0

    /**
     * `yielding`: the app did not go quiet before this read (starting, animating): the prefetch then yields to
     * its own work, as one that never yields can hold a starting app's UI thread against its input (ANRs at
     * app start in the A/B). Slower on a busy app; a quiet app is read uninterrupted.
     */
    fun capture(
        maxDepth: Int = 128,
        maxNodes: Int = 5_000,
        budgetMs: Long = 8_000,
        yielding: Boolean = false,
        /** Each framework node with its index, while the walk still holds it (a11y.read's). */
        onNode: ((Int, AccessibilityNodeInfo) -> Unit)? = null,
    ): Capture {
        val start = SystemClock.uptimeMillis()
        val ua = automation.ua
        automation.clearCache()
        val prefetch = if (yielding) PREFETCH_YIELDING else PREFETCH
        val windows = mutableListOf<CWindow>()
        val roots = mutableListOf<Pair<AccessibilityNodeInfo, Int>>()
        val list: List<AccessibilityWindowInfo> = try {
            ua.windows.sortedBy { it.layer }
        } catch (_: Throwable) {
            emptyList()
        }
        for (w in list) {
            val root = (if (Build.VERSION.SDK_INT >= 33) w.getRoot(prefetch) else w.root) ?: continue
            val b = Rect().also { w.getBoundsInScreen(it) }
            windows += CWindow(w.id, w.type, root.packageName?.toString(), w.layer, b, w.isActive, w.isFocused)
            roots += root to windows.size - 1
        }
        if (roots.isEmpty()) {
            val root = ua.rootInActiveWindow
                ?: throw AgentFailure("NOT_FOUND", "no window to read (screen off or locked?)")
            val b = Rect().also { root.getBoundsInScreen(it) }
            windows += CWindow(-1, AccessibilityWindowInfo.TYPE_APPLICATION, root.packageName?.toString(), 0, b, true, true)
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
                onNode?.invoke(nodes.size, item.first)
                nodes += copy(item.first, item.second, item.third)
            }
            if (truncated || ++depth >= maxDepth || SystemClock.uptimeMillis() - start > budgetMs) {
                truncated = truncated || level.any { it.first.childCount > 0 }
                break
            }
            level = children(level, indices, prefetch)
        }
        return Capture(windows, nodes, truncated || failedReads > 0, SystemClock.uptimeMillis() - start, Platform.display())
    }

    private class Want(val node: AccessibilityNodeInfo, val child: Int, val parent: Int, val window: Int)

    private fun children(
        level: List<Triple<AccessibilityNodeInfo, Int, Int>>,
        indices: IntArray,
        prefetch: Int,
    ): List<Triple<AccessibilityNodeInfo, Int, Int>> {
        val wanted = ArrayList<Want>()
        for ((i, item) in level.withIndex()) {
            for (c in 0 until item.first.childCount) wanted += Want(item.first, c, indices[i], item.third)
        }
        // a node the app cannot give (a web view rebuilding its virtual tree) is left out, not fatal
        val read: (Want) -> AccessibilityNodeInfo? = { w ->
            try {
                if (Build.VERSION.SDK_INT >= 33) w.node.getChild(w.child, prefetch) else w.node.getChild(w.child)
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
        // a node below or beside the screen comes back with its far edge clipped to the screen, before its
        // near one (top 2453, bottom 2400): it is sent as empty there, never with a negative size
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
        // local fields of the node, no call to the app: what a screen reader reads as one unit, or skips
        if (!n.isImportantForAccessibility) f = f or Flags.NOT_IMPORTANT
        if (Build.VERSION.SDK_INT >= 28 && n.isScreenReaderFocusable) f = f or Flags.SCREEN_READER_FOCUSABLE
        val hint = n.hintText?.toString()
        // a field showing its hint reports the hint as its text: it has no text of its own
        val text = if (n.isShowingHintText) null else n.text?.toString()
        return CNode(
            parent, window, n.className?.toString() ?: "", n.viewIdResourceName, text,
            n.contentDescription?.toString(), hint, r.left, r.top, maxOf(r.right, r.left), maxOf(r.bottom, r.top), f,
        )
    }

    companion object {
        const val PARALLEL = 8
        private const val PREFETCH =
            AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_BREADTH_FIRST or
                AccessibilityNodeInfo.FLAG_PREFETCH_UNINTERRUPTIBLE
        /** The same prefetch, stopped by the app's UI thread when it has input or other work waiting. */
        private const val PREFETCH_YIELDING = AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_BREADTH_FIRST
    }
}
