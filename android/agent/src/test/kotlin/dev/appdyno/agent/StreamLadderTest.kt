package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamLadderTest {
    private fun climb(ladder: StreamLadder): List<EncoderStep> {
        val steps = arrayListOf(ladder.current)
        while (true) steps += ladder.failed(0) ?: return steps
    }

    @Test
    fun theFirstStepIsWhatWasAsked() {
        assertEquals(EncoderStep(MIME_H264, 2400, false, "top"), StreamLadder("h264", 2400).current)
        assertEquals(MIME_HEVC, StreamLadder("hevc", 2400).current.mime)
        assertEquals(1280, StreamLadder("h264", 2400, 1280).current.maxSize)
    }

    @Test
    fun restartsThreeTimesThenGoesSmaller() {
        val steps = climb(StreamLadder("h264", 2400))
        assertEquals(listOf(2400, 2400, 2400, 2400, 1920, 1600, 1280, 1024, 800), steps.take(9).map { it.maxSize })
        assertTrue(steps.take(9).all { it.mime == MIME_H264 && !it.software })
    }

    @Test
    fun thenTheOtherCodecThenSoftwareThenNothing() {
        val steps = climb(StreamLadder("h264", 1600))
        val other = steps.filter { it.mime == MIME_HEVC }
        assertEquals(listOf(1600, 1280, 1024, 800), other.map { it.maxSize })
        assertTrue(other.none { it.software })
        val soft = steps.filter { it.software }
        assertEquals(listOf(1600, 1280, 1024, 800), soft.map { it.maxSize })
        assertTrue(soft.all { it.mime == MIME_H264 })
        assertTrue(steps.indexOf(other.first()) > steps.indexOfLast { it.mime == MIME_H264 && !it.software })
        assertTrue(steps.indexOf(soft.first()) > steps.indexOf(other.last()))
    }

    @Test
    fun aScreenSmallerThanEverySizeOnlyRestarts() {
        val steps = climb(StreamLadder("hevc", 720))
        assertEquals(4 + 1 + 1, steps.size)
    }

    @Test
    fun aFailureAfterAGoodRunStaysOnItsStep() {
        val ladder = StreamLadder("h264", 2400)
        val top = ladder.current
        assertEquals(top, ladder.failed(StreamLadder.RAN_WELL_MS))
        assertEquals(top, ladder.current)
        ladder.failed(0)
        assertEquals("restarted 1", ladder.current.note)
    }

    @Test
    fun theLastFailureEndsIt() {
        val ladder = StreamLadder("h264", 800)
        while (ladder.failed(0) != null) Unit
        assertNull(ladder.failed(0))
    }

    @Test
    fun picturesAreEvenAndScaledWithinTheirSize() {
        assertEquals(1080 to 2400, streamSize(1080, 2400, 2400))
        assertEquals(1080 to 2280, streamSize(1081, 2281, 2400))
        assertEquals(864 to 1920, streamSize(1080, 2400, 1920))
        assertEquals(1920 to 864, streamSize(2400, 1080, 1920))
        val (w, h) = streamSize(1284, 2778, 1024)
        assertEquals(0, w % 8)
        assertEquals(0, h % 8)
        assertTrue(h <= 1024)
    }

    /** The same run twice, seconds apart, its frames a frame's time apart: the first says nothing by itself. */
    private fun paceOf(vararg ms: Long) = EncoderPace().let { pace ->
        val first = ms.mapIndexed { i, each -> pace.tooSlow(each, 1_000L + i * 11) }.last()
        assertNull(first)
        ms.mapIndexed { i, each -> pace.tooSlow(each, 5_000L + i * 11) }.last()
    }

    @Test
    fun runsOfMotionSayWhetherASizeKeepsUp() {
        // what the agent read on the phones, the first five frames of a run
        assertEquals(152L, paceOf(164, 158, 152, 147, 150)) // a Samsung SM-A525F, 1080x2400 at 90 Hz
        assertEquals(72L, paceOf(89, 78, 72, 62, 55)) // the same at 720x1600
        assertNull(paceOf(22, 22, 19, 13, 12)) // the same at 576x1280
        assertNull(paceOf(71, 43, 26, 24, 24)) // a Xiaomi 25078RA3EY at its own 720x1600
    }

    @Test
    fun aBlipIsNoRun() {
        // a clock's tick and a ripple on the Samsung, seconds apart, among its slow runs
        val pace = EncoderPace()
        var at = 0L
        for (blip in listOf(listOf(48L, 40L), listOf(42L), listOf(49L, 40L, 43L), listOf(47L), listOf(30L, 37L))) {
            at += 2_000
            blip.forEachIndexed { i, ms -> assertNull(pace.tooSlow(ms, at + i * 11)) }
        }
    }

    @Test
    fun aSmallFirstRunBlessesNothing() {
        val pace = EncoderPace()
        listOf(30L, 30L, 30L, 30L, 30L).forEachIndexed { i, ms -> assertNull(pace.tooSlow(ms, 1_000L + i)) }
        listOf(150L, 150L, 150L, 150L, 150L).forEachIndexed { i, ms -> assertNull(pace.tooSlow(ms, 3_000L + i)) }
        val last = listOf(150L, 150L, 150L, 150L, 150L).mapIndexed { i, ms -> pace.tooSlow(ms, 6_000L + i) }.last()
        assertEquals(150L, last)
    }

    @Test
    fun aStallBetweenGoodRunsCostsNothingAndAWrongClockSaysNothing() {
        val pace = EncoderPace()
        for ((n, ms) in listOf(30L, 500L, 30L, 500L, 30L).withIndex()) {
            repeat(EncoderPace.FRAMES) { assertNull(pace.tooSlow(ms, n * 1_000L + it)) }
        }
        repeat(EncoderPace.FRAMES * 3) { assertNull(pace.tooSlow(-5_000, 9_000L + it * 500)) }
    }

    @Test
    fun aSlowPictureGoesStraightToTheSizeThatWillKeepUp() {
        // the Samsung's 2400 lines: its runs read 124 to 171 ms, and 1600 lines still read 72
        for (ms in listOf(124L, 152L, 171L)) {
            val ladder = StreamLadder("h264", 2400)
            assertEquals(1280, ladder.smaller(ms)!!.maxSize)
            assertEquals(1280, ladder.current.maxSize)
            assertEquals(MIME_H264, ladder.current.mime)
        }
    }

    @Test
    fun aSlowPictureAtTheSmallestSizeStays() {
        val ladder = StreamLadder("h264", 800)
        assertNull(ladder.smaller(500))
        assertEquals(800, ladder.current.maxSize)
    }

    @Test
    fun bitRateGoesBySizeAndQuality() {
        assertEquals(8_000_000, streamBitRate(1280, 720, "auto"))
        assertEquals(16_000_000, streamBitRate(1280, 720, "high"))
        assertEquals(4_000_000, streamBitRate(1280, 720, "standard"))
        assertTrue(streamBitRate(320, 240, "standard") >= 1_000_000)
        assertTrue(streamBitRate(4000, 4000, "high") <= 80_000_000)
    }
}
