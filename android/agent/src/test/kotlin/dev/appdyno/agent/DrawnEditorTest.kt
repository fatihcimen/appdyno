package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DrawnEditorTest {
    /** Looks every 40 ms: the field with the focus at each time, and the editor the app draws there. */
    private fun firstFound(old: String?, field: (Long) -> String?, drawn: (Long) -> String?): Pair<Long, String?> {
        val steady = FocusWait.Steady<String>(FocusWait.DRAWN_MS)
        var at = 0L
        while (at <= 3_000) {
            FocusWait.look(field(at), { it != old }, { drawn(at) }, steady, at)?.let { return at to it }
            at += 40
        }
        return at to null
    }

    @Test
    fun anEditorTheAppDrawsIsTakenOnceItHeldTheFocusHalfASecond() {
        // Saber's page: no field has the focus, the keyboard is up, its page has it
        assertEquals(520L to "page", firstFound(null, { null }, { "page" }))
    }

    @Test
    fun aFieldThatTakesTheFocusMeanwhileIsTheField() {
        // a tapped field (Saber's title) tells its focus 200 ms after the tap
        assertEquals(200L to "title", firstFound(null, { if (it >= 200) "title" else null }, { "page" }))
    }

    @Test
    fun neverWhileTheFieldTypedBeforeHasTheFocus() {
        // Chrome names the field typed before for a second: the editor is not taken meanwhile, and its hold starts after
        assertEquals(1_520L to "page", firstFound("name", { if (it < 1_000) "name" else null }, { "page" }))
    }

    @Test
    fun aFlickerStartsTheHoldAgain() {
        assertEquals(960L to "page", firstFound(null, { null }, { if (it == 400L) null else "page" }))
        assertNull(firstFound(null, { null }, { null }).second)
    }
}
