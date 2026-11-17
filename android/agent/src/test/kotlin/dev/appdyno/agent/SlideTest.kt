package dev.appdyno.agent

import android.graphics.Rect
import android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION
import android.view.accessibility.AccessibilityWindowInfo.TYPE_INPUT_METHOD
import android.view.accessibility.AccessibilityWindowInfo.TYPE_SYSTEM
import org.junit.Assert.assertEquals
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
    fun aWindowDrawnSmallerAlikeBothWaysIsScaled() {
        // a Flutter app's window growing as it came to the front, its root at (57,128,1023,2272) of 1080 x 2400
        assertTrue(Slide.scaled(966, 2144, 1080, 2400))
        // a dialog growing in, 876 x 1510 of 1024 x 1765
        assertTrue(Slide.scaled(876, 1510, 1024, 1765))
        assertFalse(Slide.scaled(1024, 1765, 1024, 1765))
        // the matrix's rounding midway through a slide
        assertFalse(Slide.scaled(1079, 2400, 1080, 2400))
        // a slide or a keyboard's pan cuts one side off
        assertFalse(Slide.scaled(1080, 1800, 1080, 2400))
        assertFalse(Slide.scaled(700, 2400, 1080, 2400))
        // no size in the window before API 34
        assertFalse(Slide.scaled(966, 2144, 0, 0))
    }

    @Test
    fun aScreenWhoseWindowGrowsOrSticksOutIsNotAtRest() {
        fun rect(l: Int, t: Int, r: Int, b: Int) = Rect().apply {
            left = l
            top = t
            right = r
            bottom = b
        }
        val bar = CWindow(166, TYPE_SYSTEM, "com.android.systemui", 1, rect(0, 0, 1080, 74), false, false)
        fun shown(vararg windows: CWindow) = Capture(
            listOf(*windows),
            windows.indices.map { CNode(-1, it, "android.widget.FrameLayout", null, null, null, null, 0, 0, 10, 10, Flags.VISIBLE) },
            false,
            0,
            d,
        )
        // a sign-in sheet over an app, read as it came in from past the right edge (its "Turn on" at x 1869), grew, and stood
        val past = CWindow(204, TYPE_APPLICATION, "sheet", 0, rect(1231, 477, 2107, 1987), true, true, scaled = true)
        val growing = CWindow(204, TYPE_APPLICATION, "sheet", 0, rect(97, 477, 973, 1987), true, true, scaled = true)
        val still = CWindow(204, TYPE_APPLICATION, "sheet", 0, rect(28, 354, 1052, 2119), true, true)
        assertEquals(listOf("204 1231,477,2107,1987 0,0"), shown(past, bar).restless)
        // by where it is: one that grew on is another
        assertEquals(listOf("204 97,477,973,1987 0,0"), shown(growing, bar).restless)
        assertEquals(emptyList<String>(), shown(still, bar).restless)
        // the status bar's is not the screen's place
        assertEquals(emptyList<String>(), shown(still, CWindow(166, TYPE_SYSTEM, "com.android.systemui", 1, rect(0, 0, 1080, 74), false, false, scaled = true)).restless)
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
