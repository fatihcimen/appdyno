package dev.appdyno.agent

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class KeysTest {
    @Test
    fun aLetterADigitAndANamedKey() {
        assertEquals(KeyEvent.KEYCODE_A, Input.codeOf("a"))
        assertEquals(KeyEvent.KEYCODE_Z, Input.codeOf("z"))
        assertEquals(KeyEvent.KEYCODE_0, Input.codeOf("0"))
        assertEquals(KeyEvent.KEYCODE_9, Input.codeOf("9"))
        assertEquals(KeyEvent.KEYCODE_DPAD_LEFT, Input.codeOf("arrowLeft"))
    }

    @Test(expected = AgentFailure::class)
    fun aKeyThereIsNot() {
        Input.codeOf("warp")
    }

    @Test
    fun commandIsCtrl() {
        val held = Input.heldOf(listOf("command", "shift"))
        assertEquals(listOf(KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.KEYCODE_SHIFT_LEFT), held.map { it.code })
    }
}
