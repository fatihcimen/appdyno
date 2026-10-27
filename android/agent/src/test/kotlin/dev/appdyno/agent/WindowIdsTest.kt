package dev.appdyno.agent

import android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION
import android.view.accessibility.AccessibilityWindowInfo.TYPE_INPUT_METHOD
import android.view.accessibility.AccessibilityWindowInfo.TYPE_SYSTEM
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WindowIdsTest {
    @Test
    fun onlyTheAppsWindowsCount() {
        assertEquals(setOf(7, 9), WindowIds.app(listOf(7 to TYPE_APPLICATION, 8 to TYPE_INPUT_METHOD, 3 to TYPE_SYSTEM, 9 to TYPE_APPLICATION)))
    }

    @Test
    fun anotherWindowInFrontOrTheReadOneGoneIsAReplacedScreen() {
        // the app restarted into its splash: a new activity window
        assertTrue(WindowIds.replaced(setOf(7), setOf(12)))
        assertTrue(WindowIds.replaced(setOf(7), setOf(7, 12)))
        assertTrue(WindowIds.replaced(setOf(7, 12), setOf(7)))
        assertFalse(WindowIds.replaced(setOf(7), setOf(7)))
        // an id not known when it was read, or no window now: no proof
        assertFalse(WindowIds.replaced(setOf(-1), setOf(12)))
        assertFalse(WindowIds.replaced(setOf(7), emptySet()))
    }
}
