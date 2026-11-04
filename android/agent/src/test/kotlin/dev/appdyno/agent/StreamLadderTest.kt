package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test
    fun lowLatencyIsAskedOnlyOfAnEncoderThatOffersIt() {
        // a Samsung SM-A525F's OMX.qcom encoders: "encoder does not support low-latency", "configureCodec returning error -22",
        // on every step of the ladder down to software
        assertFalse(asksLowLatency(34, offered = false))
        assertTrue(asksLowLatency(34, offered = true))
        assertFalse(asksLowLatency(29, offered = true)) // the key came in API 30
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
