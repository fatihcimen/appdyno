package dev.appdyno.agent

import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class CWindow(
    /** The platform's window id (-1: not known): a new activity or dialog is a new window. */
    val id: Int,
    val type: Int,
    val pkg: String?,
    val layer: Int,
    val bounds: Rect,
    val active: Boolean,
    val focused: Boolean,
    /** Fills the display at rest, on a release with getBoundsInWindow: `bounds` is that place. */
    val fills: Boolean = false,
) {
    /** How far from its resting place it is: as reported, then as the walk finds it (a node's place on the screen against its place in the window). */
    var offsetX = 0
    var offsetY = 0
    val sliding: Boolean get() = offsetX != 0 || offsetY != 0
}

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
    /** Visible nodes of a sliding window whose resting place could not be worked out. */
    val unplaced: Int = 0,
    private val tagged: List<Pair<Int, AccessibilityNodeInfo>> = emptyList(),
) {
    /**
     * Compose test tags by node, for nodes with no resource id: not layout, and each is a call to the app, so
     * only an answer asks for them, within TAGS_MS.
     */
    val tags: Map<Int, String> by lazy {
        val end = SystemClock.uptimeMillis() + TreeCapture.TAGS_MS
        val out = HashMap<Int, String>()
        for ((i, n) in tagged) {
            if (SystemClock.uptimeMillis() > end) break
            try {
                if (n.refreshWithExtraData(TreeCapture.TEST_TAG, Bundle())) n.extras.getCharSequence(TreeCapture.TEST_TAG)?.let { out[i] = it.toString() }
            } catch (_: RuntimeException) {
                // a node gone meanwhile has no tag to give
            }
        }
        out
    }

    /** The digest of the app's and the system dialogs' windows (status bar, keyboard and overlays left out). */
    val hash: String by lazy { LayoutHash.of(appNodes) }

    private fun appWindow(w: CWindow) = w.type != TYPE_IME && w.type != TYPE_OVERLAY &&
        !(w.type == TYPE_SYSTEM && (w.pkg == SYSTEM_UI || w.bounds.let { Slide.strip(it.left, it.top, it.right, it.bottom, display) }))

    /** A node of the app's or a system dialog's window (not the status bar, the keyboard, an overlay). */
    fun inApp(n: CNode) = appWindow(windows[n.window])

    /** Nothing read of a screen's window: between two screens, a dark screen, an app that does not answer. */
    val noApp: Boolean by lazy { nodes.none { n -> windows[n.window].let { Slide.hasScreen(it.type, it.bounds.left, it.bounds.top, it.bounds.right, it.bounds.bottom, display) } } }

    /** Some window on it is still on its way to the place the answer gives. */
    val sliding: Boolean get() = windows.any { it.sliding }

    /** In a transition the places in this read may not be those at rest: another shape of window, or virtual nodes. */
    val restUnknown: Boolean get() = unplaced > 0 || windows.any { it.type == AccessibilityWindowInfo.TYPE_APPLICATION && !it.fills }

    /** A point on a window that is not the app's (a key of the keyboard, the status bar). */
    fun onOtherWindow(x: Int, y: Int) = windows.any { !appWindow(it) && it.bounds.contains(x, y) }

    /** The nodes of the app's and the system dialogs' windows. */
    val appNodes: List<CNode> by lazy { nodes.filter(::inApp) }

    fun sameLayout(other: Capture) = LayoutHash.same(appNodes, other.appNodes)

    /**
     * The screen is not done: no app window, an indeterminate progress bar shows (a spinner, a loading bar), or an
     * app window sticks out of the display and its nodes' resting places are not known (a window sliding in
     * or out: its reported place stays at a midway point until the animation ends).
     */
    val busy: Boolean by lazy {
        noApp || unplaced > 0 || nodes.any { it.flags and Flags.VISIBLE != 0 && it.indeterminate } ||
            windows.any { w -> w.type == AccessibilityWindowInfo.TYPE_APPLICATION && Slide.outside(w.bounds.left, w.bounds.top, w.bounds.right, w.bounds.bottom, display) }
    }
}

/** Windows in a transition (pure, unit tested). */
object Slide {
    /** A band along an edge of the display: the status bar, a gesture handle, the handle of a maker's edge panel. */
    fun strip(left: Int, top: Int, right: Int, bottom: Int, d: DisplayInfo) = (bottom - top < d.height / 8 && (top == 0 || bottom == d.height)) ||
        (right - left < d.width / 8 && (left == 0 || right == d.width))

    /**
     * A window that is a screen: an application's, or a system one (a shade, a keyguard, a dialog such as "not
     * responding") that is not a strip. Between two screens only the strips are there, for 100 to 500 ms.
     */
    fun hasScreen(type: Int, left: Int, top: Int, right: Int, bottom: Int, d: DisplayInfo) = type == AccessibilityWindowInfo.TYPE_APPLICATION ||
        (type == AccessibilityWindowInfo.TYPE_SYSTEM && !strip(left, top, right, bottom, d))

    /** A node at this place in a window `dx`, `dy` off its own: wholly past the display, so its visibility cannot be known now. */
    fun pushedOff(left: Int, top: Int, right: Int, bottom: Int, dx: Int, dy: Int, d: DisplayInfo) = right + dx <= 0 || bottom + dy <= 0 || left + dx >= d.width || top + dy >= d.height

    fun outside(left: Int, top: Int, right: Int, bottom: Int, d: DisplayInfo) = left < 0 || top < 0 || right > d.width || bottom > d.height

    /**
     * An application window of the display's size: it slides at most, and comes to rest filling the display, where a place in the window is the place on the screen. Not known
     * for any other shape, nor without `getBoundsInWindow` (API 34).
     */
    fun fills(type: Int, width: Int, height: Int, d: DisplayInfo, sdk: Int = Build.VERSION.SDK_INT) = sdk >= 34 && type == AccessibilityWindowInfo.TYPE_APPLICATION &&
        kotlin.math.abs(width - d.width) <= 2 && kotlin.math.abs(height - d.height) <= 2
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
        val display = Platform.display()
        automation.clearCache()
        val prefetch = when {
            // no call takes the flags below 33
            Build.VERSION.SDK_INT < 33 -> 0

            yielding -> AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_BREADTH_FIRST

            else -> AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_BREADTH_FIRST or AccessibilityNodeInfo.FLAG_PREFETCH_UNINTERRUPTIBLE
        }
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
            // by its root's place in it: the window's own bounds are its touchable region, some other shape at times
            val inIt = Rect().also { if (Build.VERSION.SDK_INT >= 34) root.getBoundsInWindow(it) }
            val fills = Slide.fills(w.type, inIt.width(), inIt.height(), display)
            val window = CWindow(w.id, w.type, root.packageName?.toString(), w.layer, if (fills) Rect(0, 0, display.width, display.height) else b, w.isActive, w.isFocused, fills)
            if (fills) {
                window.offsetX = b.left
                window.offsetY = b.top
            }
            windows += window
            roots += root to windows.size - 1
        }
        if (roots.isEmpty()) {
            val root = ua.rootInActiveWindow
                ?: throw noWindow(Platform.display().on)
            val b = Rect().also { root.getBoundsInScreen(it) }
            windows += CWindow(-1, AccessibilityWindowInfo.TYPE_APPLICATION, root.packageName?.toString(), 0, b, true, true)
            roots += root to 0
        }

        // all the walk's own: a lane given up goes on with its capture beside the next lane's
        val failedReads = AtomicInteger()
        val inWindow = ArrayList<Rect?>()
        val tagged = ArrayList<Pair<Int, AccessibilityNodeInfo>>()
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
                if (item.first.viewIdResourceName == null && TEST_TAG in item.first.availableExtraData) tagged += nodes.size to item.first
                nodes += copy(item.first, item.second, item.third, windows[item.third], inWindow)
            }
            if (truncated || ++depth >= maxDepth || SystemClock.uptimeMillis() - start > budgetMs) {
                truncated = truncated || level.any { it.first.childCount > 0 }
                break
            }
            level = children(level, indices, prefetch, failedReads)
        }
        val unplaced = toRest(windows, nodes, display, inWindow)
        return Capture(windows, nodes, truncated || failedReads.get() > 0, SystemClock.uptimeMillis() - start, display, unplaced, tagged)
    }

    private class Want(val node: AccessibilityNodeInfo, val child: Int, val parent: Int, val window: Int)

    private fun children(
        level: List<Triple<AccessibilityNodeInfo, Int, Int>>,
        indices: IntArray,
        prefetch: Int,
        failedReads: AtomicInteger,
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
                failedReads.incrementAndGet()
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

    /**
     * Sliding windows' nodes, from where they are now to where they come to rest: the place in the window (`inWindow`,
     * by index; null: their window does not fill the display), and the visibility the rest will give. How many visible
     * nodes have no such place (virtual ones: Compose, a web view).
     */
    private fun toRest(windows: List<CWindow>, nodes: List<CNode>, d: DisplayInfo, inWindow: List<Rect?>): Int {
        // a keyboard panning the window moves it up with no transition running
        if (windows.any { it.type == TYPE_IME }) for (w in windows) if (w.offsetX == 0) w.offsetY = 0
        if (windows.none { it.sliding }) return 0
        var unplaced = 0
        for ((i, n) in nodes.withIndex()) {
            val w = windows[n.window]
            if (!w.sliding) continue
            val p = inWindow[i]!!
            val visible = n.flags and Flags.VISIBLE != 0
            if (p.left == 0 && p.top == 0 && p.right == 0 && p.bottom == 0) {
                if (visible && n.right > n.left && n.bottom > n.top) unplaced++
                continue
            }
            // clipped away it comes with its edges crossed: empty, as the walk sends it (the screen's matrix uncrosses them)
            n.left = p.left
            n.top = p.top
            n.right = maxOf(p.right, p.left)
            n.bottom = maxOf(p.bottom, p.top)
            val empty = n.right == n.left || n.bottom == n.top
            n.flags = when {
                // under a window above (the status bar's background) it will not be visible
                visible && windows.drop(n.window + 1).any { it.bounds.contains(n.left, n.top, n.right, n.bottom) } -> n.flags and Flags.VISIBLE.inv()

                !visible && !empty && Slide.pushedOff(n.left, n.top, n.right, n.bottom, w.offsetX, w.offsetY, d) -> n.flags or Flags.VISIBLE

                else -> n.flags
            }
        }
        return unplaced
    }

    private fun copy(n: AccessibilityNodeInfo, parent: Int, windowIndex: Int, w: CWindow, inWindow: MutableList<Rect?>): CNode {
        // a node below or beside the screen comes back with its far edge clipped to the screen, before its
        // near one (top 2453, bottom 2400): it is sent as empty there, never with a negative size
        val r = Rect().also { n.getBoundsInScreen(it) }
        var f = 0
        if (n.isVisibleToUser) f = f or Flags.VISIBLE
        if (Build.VERSION.SDK_INT >= 34 && w.fills) {
            val p = Rect().also { n.getBoundsInWindow(it) }
            inWindow += p
            // one node whole on the display says how far the window is from its place (its matrix may round a pixel);
            // the slide can end during a walk, its later nodes at rest: any node still off its place counts
            if (!p.isEmpty && kotlin.math.abs(r.width() - p.width()) <= 2 && kotlin.math.abs(r.height() - p.height()) <= 2 && (r.left != p.left || r.top != p.top)) {
                w.offsetX = r.left - p.left
                w.offsetY = r.top - p.top
            }
        } else {
            inWindow += null
        }
        if (n.isClickable) f = f or Flags.CLICKABLE
        if (n.isLongClickable) f = f or Flags.LONG_CLICKABLE
        if (n.isFocusable) f = f or Flags.FOCUSABLE
        if (n.isFocused) f = f or Flags.FOCUSED
        if (n.isEnabled) f = f or Flags.ENABLED
        // from API 36 in three states, a box checked in part among them; the boolean stays for the Androids before it
        @Suppress("DEPRECATION")
        val checked = if (Build.VERSION.SDK_INT >= 36) n.checked == AccessibilityNodeInfo.CHECKED_STATE_TRUE else n.isChecked
        if (checked) f = f or Flags.CHECKED
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
        val cls = n.className?.toString() ?: ""
        return CNode(
            parent, windowIndex, cls, n.viewIdResourceName, text,
            n.contentDescription?.toString(), hint, r.left, r.top, maxOf(r.right, r.left), maxOf(r.bottom, r.top), f,
            indeterminate = spinning(cls, n.rangeInfo?.type),
        )
    }

    companion object {
        const val PARALLEL = 8
        const val TEST_TAG = "androidx.compose.ui.semantics.testTag"
        const val TAGS_MS = 500L
    }
}
