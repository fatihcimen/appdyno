package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class PathsTest {
    @Test
    fun lineIsSampledEveryStepAndEndsOnTheTarget() {
        val s = Paths.line(0f, 0f, 100f, 200f, 100)
        assertEquals(11, s.size)
        assertEquals(0L, s.first().t)
        assertEquals(100L, s.last().t)
        assertEquals(50f, s[5].x, 0.01f)
        assertEquals(100f, s[5].y, 0.01f)
        assertEquals(200f, s.last().y, 0.01f)
    }

    @Test
    fun multiSegmentPathFollowsEachSegment() {
        val s = Paths.resample(listOf(Sample(0, 0f, 0f), Sample(20, 20f, 0f), Sample(40, 20f, 20f)))
        assertEquals(listOf(0f, 10f, 20f, 20f, 20f), s.map { it.x })
        assertEquals(listOf(0f, 0f, 0f, 10f, 20f), s.map { it.y })
    }

    @Test
    fun singlePointStays() {
        assertEquals(1, Paths.resample(listOf(Sample(0, 5f, 5f))).size)
    }
}
