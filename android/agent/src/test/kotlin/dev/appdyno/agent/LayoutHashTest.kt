package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutHashTest {
    private fun node(text: String?, l: Int, r: Int, flags: Int = Flags.VISIBLE, top: Int = 10, id: String? = "a:id/x") =
        CNode(-1, 0, "android.widget.TextView", id, text, null, null, l, top, r, top + 20, flags)

    @Test
    fun textAndItsWidthAreNoLayoutChange() {
        assertEquals(LayoutHash.of(listOf(node("10", 100, 140))), LayoutHash.of(listOf(node("9", 105, 135))))
    }

    @Test
    fun aMovedControlIsAChange() {
        val c = Flags.VISIBLE or Flags.CLICKABLE
        assertNotEquals(LayoutHash.of(listOf(node("Ekle", 100, 140, c))), LayoutHash.of(listOf(node("Ekle", 120, 160, c))))
        assertNotEquals(LayoutHash.of(listOf(node("a", 0, 10))), LayoutHash.of(listOf(node("a", 0, 10, top = 50))))
    }

    @Test
    fun sameLayoutToleratesSmallMovesOnly() {
        val c = Flags.VISIBLE or Flags.CLICKABLE
        assertTrue(LayoutHash.same(listOf(node("Dur", 3, 1019, c)), listOf(node("Dur", 0, 1016, c))))
        assertFalse(LayoutHash.same(listOf(node("Dur", 0, 100, c)), listOf(node("Dur", 20, 120, c))))
        assertFalse(LayoutHash.same(listOf(node("a", 0, 10)), listOf(node("a", 0, 10), node("b", 0, 10))))
        // a text whose width follows its content is the same layout
        assertTrue(LayoutHash.same(listOf(node("10", 100, 140)), listOf(node("9", 60, 180))))
    }

    @Test
    fun emptyBoxesDoNotCount() {
        // a carousel page scrolled away: zero width, its place changes as the carousel turns
        val page = { l: Int -> node(null, l, l, Flags.VISIBLE or Flags.CLICKABLE) }
        assertEquals(LayoutHash.of(listOf(page(0))), LayoutHash.of(listOf(page(1080))))
        assertTrue(LayoutHash.same(listOf(node("a", 0, 10), page(0)), listOf(node("a", 0, 10), page(1080))))
    }

    @Test
    fun invisibleNodesDoNotCount() {
        assertEquals(LayoutHash.of(listOf()), LayoutHash.of(listOf(node("x", 0, 10, flags = 0))))
    }
}

class HitTestTest {
    private fun n(parent: Int, cls: String, l: Int, t: Int, r: Int, b: Int, flags: Int = Flags.VISIBLE) =
        CNode(parent, 0, cls, null, null, null, null, l, t, r, b, flags)

    private val screen = listOf(
        n(-1, "FrameLayout", 0, 0, 1000, 2000),
        n(0, "LinearLayout", 0, 0, 1000, 600, Flags.VISIBLE or Flags.CLICKABLE), // a card
        n(1, "TextView", 0, 0, 500, 100), // its title
        n(0, "TextView", 0, 700, 1000, 800), // plain text
        n(0, "android.webkit.WebView", 0, 900, 1000, 1500),
        n(0, "Button", 0, 1600, 500, 1700, Flags.CLICKABLE), // not visible
    )

    @Test
    fun textInsideAClickableCardIsActionable() = assertTrue(HitTest.actionable(screen, 100, 50))

    @Test
    fun plainTextAndEmptySpaceAreNot() {
        assertFalse(HitTest.actionable(screen, 100, 750))
        assertFalse(HitTest.actionable(screen, 100, 1800))
    }

    @Test
    fun aWebViewTakesTouchesItself() = assertTrue(HitTest.actionable(screen, 100, 1000))

    @Test
    fun anInvisibleButtonDoesNotCountAndNoScreenMeansCareful() {
        assertFalse(HitTest.actionable(screen, 100, 1650))
        assertTrue(HitTest.actionable(null, 1, 1))
        assertTrue(HitTest.actionable(screen, 5000, 5000))
    }
}
