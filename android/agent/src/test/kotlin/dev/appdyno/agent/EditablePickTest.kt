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

    @Test
    fun aPointOnTheFieldIsThatField() {
        assertEquals(3, EditablePick.under(boxes, parents, editable, 500, 700))
    }

    @Test
    fun aPointOnTheLayoutButNotItsFieldIsItsOnlyField() {
        // the layout's middle (y 750) is on its helper text: the layout's field is meant
        assertEquals(3, EditablePick.under(boxes, parents, editable, 500, 820))
        assertEquals(6, EditablePick.under(boxes, parents, editable, 500, 1200))
    }

    @Test
    fun noGuessWhenTheSmallestHolderHasSeveralFieldsOrNone() {
        // only the screen holds both fields: ambiguous
        assertNull(EditablePick.under(boxes, parents, editable, 500, 300))
        assertNull(EditablePick.under(boxes, parents, listOf(false, false, false, false, false, false, false), 500, 820))
    }
}
