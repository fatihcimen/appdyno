package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EditablePickTest {
    private fun box(l: Int, t: Int, r: Int, b: Int) = intArrayOf(l, t, r, b)

    // 0 screen; 1 a text-input layout (label above, helper text below); 2 its label; 3 its field; 4 its
    // helper text; 5 a second layout below with 6 its field
    private val boxes = listOf(
        box(0, 0, 1080, 2400),
        box(40, 600, 1040, 900),
        box(40, 600, 1040, 650),
        box(40, 650, 1040, 760),
        box(40, 760, 1040, 900),
        box(40, 950, 1040, 1250),
        box(40, 1000, 1040, 1110),
    )
    private val parents = listOf(-1, 0, 1, 1, 1, 0, 5)
    private val editable = listOf(false, false, false, true, false, false, true)
    private val control = List(7) { false }

    @Test
    fun aPointOnTheFieldIsThatField() {
        assertEquals(3, EditablePick.under(boxes, parents, editable, control, 500, 700))
    }

    @Test
    fun aPointOnTheLayoutButNotItsFieldIsItsOnlyField() {
        // the layout's middle (y 750) is on its helper text: the layout's field is meant
        assertEquals(3, EditablePick.under(boxes, parents, editable, control, 500, 820))
        assertEquals(6, EditablePick.under(boxes, parents, editable, control, 500, 1200))
    }

    @Test
    fun noGuessWhenTheSmallestHolderHasSeveralFieldsOrNone() {
        // only the screen holds both fields: ambiguous
        assertNull(EditablePick.under(boxes, parents, editable, control, 500, 300))
        assertNull(EditablePick.under(boxes, parents, List(7) { false }, control, 500, 820))
    }

    // Saber's note in its drawing mode, as read raw (Flutter): 0-8 the screen's frames, 9 the top bar, 10 the page,
    // 11 the colour bar, 12-25 the tool buttons, 26-31 the top bar's buttons and the title's frame (28), 32 its frame
    // and 33 the title, the screen's one field
    private val saber = listOf(
        box(0, 0, 1080, 2400), box(0, 0, 1080, 2400), box(0, 0, 1080, 2400), box(0, 0, 1080, 2400),
        box(0, 0, 1080, 2400), box(0, 0, 1080, 2400), box(0, 0, 1080, 2400), box(0, 0, 1080, 2400),
        box(0, 0, 1080, 2400), box(0, 0, 1080, 283), box(0, 367, 1080, 1879), box(0, 1921, 1080, 2064),
        box(78, 2085, 183, 2190), box(215, 2085, 320, 2190), box(351, 2085, 456, 2190), box(487, 2085, 593, 2190),
        box(624, 2085, 729, 2190), box(761, 2085, 866, 2190), box(897, 2085, 1002, 2190), box(78, 2211, 183, 2316),
        box(215, 2211, 320, 2316), box(351, 2211, 456, 2316), box(487, 2211, 593, 2316), box(624, 2211, 729, 2316),
        box(761, 2211, 866, 2316), box(897, 2211, 1002, 2316), box(11, 147, 137, 273), box(11, 147, 137, 273),
        box(189, 147, 660, 273), box(702, 147, 828, 273), box(828, 147, 954, 273), box(954, 147, 1080, 273),
        box(189, 147, 660, 273), box(189, 147, 660, 273),
    )
    private val saberParents = listOf(-1, 0, 1, 2, 3, 4, 5, 6, 7, 8) + List(16) { 8 } + List(6) { 9 } + listOf(28, 32)
    private val saberEditable = List(34) { it == 33 }
    private val saberControl = List(34) { it in 12..33 && it != 24 && it != 28 && it != 32 }

    private fun saberAt(x: Int, y: Int) = EditablePick.under(saber, saberParents, saberEditable, saberControl, x, y)

    @Test
    fun aPointOnTheNotesPageIsNotItsTitle() {
        // the screen holds the title only: 44 times its area, it is no holder of the title's own
        assertNull(saberAt(540, 900))
    }

    @Test
    fun aPointOnAnotherControlIsNotTheFieldBesideIt() {
        // the bar that holds the title is 5 times its area, but the point is on its button Pages
        assertNull(saberAt(891, 210))
        assertEquals(33, saberAt(425, 210))
        // on the bar beside the title, on no control: the bar is the title's own
        assertEquals(33, saberAt(680, 210))
    }
}
