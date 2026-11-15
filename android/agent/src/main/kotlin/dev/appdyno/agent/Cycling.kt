package dev.appdyno.agent

/** A capture's nodes with each one's parent as an index into them: the app's, with the other windows' left out. */
class Layout(val nodes: List<CNode>, val parents: IntArray) {
    constructor(nodes: List<CNode>) : this(nodes, IntArray(nodes.size) { nodes[it].parent })
}

/** Where two reads of a screen differ. */
object Region {
    /** No one view under half the screen holds what differs. */
    const val WHOLE = ""

    /**
     * The one view that holds every node which moved, came or went between two reads, itself in place in both and
     * under half of `screenArea`, as its class, id and place; WHOLE where there is none, null where the layouts are the same.
     */
    fun between(a: Layout, b: Layout, screenArea: Long): String? {
        if (LayoutHash.same(a.nodes, b.nodes)) return null
        // a view comes before what it holds, so the views over the first node that differs are the same in both reads
        var first = 0
        while (first < a.nodes.size && first < b.nodes.size && a.parents[first] == b.parents[first] && LayoutHash.alike(a.nodes[first], b.nodes[first])) first++
        val over = sortedSetOf<Int>(reverseOrder())
        for (l in listOf(a, b)) {
            var c = if (first < l.parents.size) l.parents[first] else -1
            while (c >= 0) {
                over += c
                c = l.parents[c]
            }
        }
        // the lowest of them first: the rest of the screen is the same without what it holds
        val holder = over.firstOrNull { LayoutHash.same(outside(a, it), outside(b, it)) } ?: return WHOLE
        val n = a.nodes[holder]
        val area = (n.right - n.left).toLong() * (n.bottom - n.top)
        return if (area * 2 > screenArea) WHOLE else name(n)
    }

    private fun name(n: CNode) = "${n.cls}#${n.id}@${n.left},${n.top},${n.right},${n.bottom}"

    /** The layout's nodes with what is under the view of that name left out; null where the screen has no such view. */
    fun without(l: Layout, view: String): List<CNode>? {
        val holder = l.nodes.indexOfFirst { name(it) == view }
        return if (holder < 0) null else outside(l, holder)
    }

    /** The nodes that are not under the view at `holder`. */
    private fun outside(l: Layout, holder: Int): List<CNode> {
        val under = BooleanArray(l.nodes.size)
        return l.nodes.filterIndexed { i, _ ->
            val p = l.parents[i]
            under[i] = p >= 0 && (p == holder || under[p])
            !under[i]
        }
    }
}

/**
 * A part of the screen that keeps changing by itself, as a banner that turns or a line of text that runs: told from a
 * transition by where it is and how long it goes on. Reads that differ under one view only, never GAP_MS apart, for
 * CYCLE_MS, longer than a transition lasts, make it known to cycle, and from then a change under it alone is none: the
 * screen is as still as the rest of it. A change anywhere else is one as before. Not seen moving for KEPT_MS, the view
 * is known no longer. Time is given, so the logic runs in a unit test.
 */
class Cycling(private val clock: () -> Long) {
    /** Where the reads have kept differing, since when, and when last. */
    private var moving: String? = null
    private var since = 0L
    private var movedAt = 0L

    /** The view known to cycle, or NOISE, and when it was last seen to. */
    private var known: String? = null
    private var knownAt = 0L

    /** Something here is known to keep the app's events coming: they say nothing of the rest of the screen. */
    val active get() = known != null && clock() - knownAt <= KEPT_MS

    /**
     * Whether `next` is `prev` to a settle: the same layout, or one that differs only under the view known to cycle.
     * `byItself`: what moves now was moving before the action being settled, and no action of ours set it off: only
     * then can reads make a view known. A row our own swipe threw runs as long as a banner does.
     */
    fun same(next: Layout, prev: Layout, screenArea: Long, byItself: Boolean = true): Boolean {
        val where = Region.between(prev, next, screenArea) ?: return true
        val now = clock()
        if (where == Region.WHOLE) {
            moving = null
            return false
        }
        if (where == known && active) {
            knownAt = now
            return true
        }
        if (!byItself) return false
        if (where != moving || now - movedAt > GAP_MS) {
            moving = where
            since = now
        }
        movedAt = now
        if (now - since < CYCLE_MS) return false
        known = where
        knownAt = now
        return true
    }

    /**
     * The app's events never stopped for all of a read's wait, and what the read shows differs from the one before it
     * under one view at most: that view cycles, or with no difference at all the events are of something no layout shows.
     */
    fun eventsKeptComing(next: Layout, prev: Layout, screenArea: Long) {
        val where = Region.between(prev, next, screenArea)
        if (where == Region.WHOLE) return
        known = where ?: NOISE
        knownAt = clock()
    }

    /**
     * The digest a read of this layout answers with: without what the view known to cycle holds, so that a caller who
     * compares digests sees one screen whatever the banner shows. Null where no such view is on it.
     */
    fun digest(l: Layout): String? = known?.takeIf { active }?.let { Region.without(l, it) }?.let(LayoutHash::of)

    /** The events still come, and a read has shown the rest of the screen still. */
    fun stillCycling() {
        knownAt = clock()
    }

    companion object {
        /** Events with no layout behind them: a bar that fills, a drawing that plays. */
        private const val NOISE = "~"

        /** A slide of a page or a sheet is over well within this. */
        const val CYCLE_MS = 1_000L

        /** A banner that steps this far apart leaves the settle its quiet window between two steps. */
        const val GAP_MS = 300L
        const val KEPT_MS = 30_000L
    }
}
