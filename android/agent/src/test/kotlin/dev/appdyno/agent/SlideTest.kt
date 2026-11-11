package dev.appdyno.agent

import android.graphics.Rect
import android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION
import android.view.accessibility.AccessibilityWindowInfo.TYPE_INPUT_METHOD
import android.view.accessibility.AccessibilityWindowInfo.TYPE_SYSTEM
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SlideTest {
    private val d = DisplayInfo(1080, 2400, 420, 0)

    @Test
    fun onlyAProgressBarWithNoRangeKeepsTheScreenBusy() {
        val screen = Rect().apply {
            right = 1080
            bottom = 2400
        }
        val app = CWindow(1, TYPE_APPLICATION, "app", 0, screen, true, true)
        fun bar(indeterminate: Boolean) = Capture(
            listOf(app),
            listOf(CNode(-1, 0, "android.widget.ProgressBar", null, null, null, null, 40, 400, 1040, 440, Flags.VISIBLE, indeterminate)),
            false,
            0,
            d,
        )
        assertTrue(bar(indeterminate = true).busy)
        // a step bar, an order's progress: it stands still
        assertFalse(bar(indeterminate = false).busy)
    }

    @Test
    fun aSpinnerIsOneWithNoRangeOrFromAndroid16OneOfTheIndeterminateType() {
        assertTrue(spinning("android.widget.ProgressBar", null))
        // RangeInfo.RANGE_TYPE_INDETERMINATE: an Android 16 phone's spinner, which a check for no range took for a still bar
        assertTrue(spinning("android.widget.ProgressBar", 3))
        assertFalse(spinning("android.widget.ProgressBar", 0))
        assertFalse(spinning("android.widget.SeekBar", null))
    }

    @Test
    fun theStatusBarIsNoScreen() {
        assertFalse(Slide.hasScreen(TYPE_SYSTEM, 0, 0, 1080, 128, d))
        assertFalse(Slide.hasScreen(TYPE_SYSTEM, 0, 2355, 1080, 2400, d)) // a gesture handle
        assertFalse(Slide.hasScreen(TYPE_SYSTEM, 1038, 458, 1080, 800, d)) // the edge panel handle of a Samsung SM-A525F
        assertTrue(Slide.hasScreen(TYPE_SYSTEM, 100, 1000, 980, 1300, d)) // a small system dialog
        assertTrue(Slide.hasScreen(TYPE_SYSTEM, 0, 0, 1080, 2400, d)) // a shade, a keyguard
        assertTrue(Slide.hasScreen(TYPE_APPLICATION, 0, 0, 1080, 128, d))
        assertFalse(Slide.hasScreen(TYPE_INPUT_METHOD, 0, 1500, 1080, 2400, d))
    }

    @Test
    fun aWindowOfTheDisplaysSizeFillsItAtRest() {
        // midway the matrix rounds it to 1079 wide (-107,0,972,2400)
        assertTrue(Slide.fills(TYPE_APPLICATION, 1079, 2400, d, 34))
        assertTrue(Slide.fills(TYPE_APPLICATION, 1080, 2400, d, 36))
        assertFalse(Slide.fills(TYPE_APPLICATION, 1080, 2400, d, 33))
        assertFalse(Slide.fills(TYPE_APPLICATION, 900, 1200, d, 34)) // a dialog activity, a split screen
        assertFalse(Slide.fills(TYPE_SYSTEM, 1080, 2400, d, 34))
    }

    @Test
    fun aNodeIsPushedOffOnlyWhenWhollyPastTheDisplay() {
        // the window 107 px left of its place: its first 107 px are past the edge
        assertTrue(Slide.pushedOff(0, 0, 100, 50, -107, 0, d))
        assertFalse(Slide.pushedOff(0, 0, 200, 50, -107, 0, d))
        assertFalse(Slide.pushedOff(300, 0, 400, 50, -107, 0, d))
        // coming in from the right, 80 px short of its place
        assertTrue(Slide.pushedOff(1000, 0, 1080, 50, 80, 0, d))
        assertFalse(Slide.pushedOff(900, 0, 1080, 50, 80, 0, d))
    }
}
