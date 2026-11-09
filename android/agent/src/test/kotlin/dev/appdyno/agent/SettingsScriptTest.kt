package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsScriptTest {
    @Test
    fun theScalesComeBackAsTheyWere() {
        val script = SettingsScript.restore("global", listOf("a" to "1.0", "b" to "null", "c" to "0.5"))
        assertEquals("settings put global a 1.0; settings delete global b; settings put global c 0.5", script)
    }

    @Test
    fun theRotationLockComesBackWithItsUserRotation() {
        val script = SettingsScript.restore("system", listOf("user_rotation" to "0", "accelerometer_rotation" to "1"))
        assertEquals("settings put system user_rotation 0; settings put system accelerometer_rotation 1", script)
    }

    @Test
    fun anythingButANumberIsLeftAlone() {
        assertEquals("true", SettingsScript.restore("global", listOf("a" to "1; reboot")))
    }

    @Test
    fun theWatcherWaitsForTheAgentToGoFirst() {
        val w = SettingsScript.watch(42, "system", listOf("a" to "1"))
        assertTrue(w, w.startsWith("while kill -0 42 2>/dev/null; do sleep 1; done; settings put system a 1"))
    }
}
