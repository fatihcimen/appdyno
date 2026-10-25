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
    fun invisibleNodesDoNotCount() {
        assertEquals(LayoutHash.of(listOf()), LayoutHash.of(listOf(node("x", 0, 10, flags = 0))))
    }
}
