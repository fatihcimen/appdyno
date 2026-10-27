package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class TextClipTest {
    /** One line of characters `w` wide from x 0, as the platform places them. */
    private fun line(n: Int, w: Float = 9f) = List(n) { i -> floatArrayOf(i * w, 10f, i * w + w, 30f) }

    @Test
    fun aTextShownWholeHidesNothing() {
        assertEquals(0, TextClip.hidden("Sepete ekle", line(11)))
    }

    @Test
    fun charactersWithoutAPlaceAreHidden() {
        // "Ayran 2 L" whose frame ends after the space: "2" and "L" have no visible place
        assertEquals(2, TextClip.hidden("Ayran 2 L", line(6) + listOf(null, null, null)))
    }

    @Test
    fun anEllipsizedTailCollapsesOntoOnePlace() {
        // "Kaçmaz Fırsat" shown as "Kaçmaz F…": the ellipsis takes "ı", the rest sit on one point after it
        val shown = line(8)
        val tail = listOf(floatArrayOf(72f, 10f, 81f, 30f)) + List(4) { floatArrayOf(81f, 10f, 90f, 30f) }
        assertEquals(3, TextClip.hidden("Kaçmaz Fırsat", shown + tail))
    }

    @Test
    fun zeroWidthCharactersAreHidden() {
        assertEquals(2, TextClip.hidden("abcd", line(2) + List(2) { floatArrayOf(18f, 10f, 18f, 30f) }))
    }

    @Test
    fun spacesAndFormatCharactersNeverCount() {
        assertEquals(0, TextClip.hidden("a b​c", listOf(line(1)[0], null, line(2)[1], null, line(3)[2])))
    }

    @Test
    fun theSamePlaceOnAnotherLineIsNoCollapse() {
        val two = line(3) + List(3) { i -> floatArrayOf(i * 9f, 40f, i * 9f + 9f, 60f) }
        assertEquals(0, TextClip.hidden("abcdef", two))
    }

    @Test
    fun onlyLocatedCharactersAreCounted() {
        assertEquals(0, TextClip.hidden("abc", line(1)))
    }
}
