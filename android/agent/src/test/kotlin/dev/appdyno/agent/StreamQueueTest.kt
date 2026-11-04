package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamQueueTest {
    private var time = 0L
    private var asks = 0
    private val queue = StreamQueue(capacity = 3, now = { time }, askForKey = { asks++ })

    private fun frame(flags: Int = 0, id: Int = 0) = VideoFrame(id.toLong(), 0, flags, ByteArray(1))
    private val key get() = frame(VideoFrame.FLAG_KEY)
    private val config get() = frame(VideoFrame.FLAG_CONFIG)

    @Test
    fun framesPassInOrderWhileThereIsRoom() {
        queue.offer(frame(id = 1))
        queue.offer(frame(id = 2))
        assertEquals(1L, queue.take()!!.ptsUs)
        assertEquals(2L, queue.take()!!.ptsUs)
        assertEquals(0L, queue.dropped)
        assertEquals(0, asks)
    }

    @Test
    fun aFullQueueDropsAndAsksForAKeyframeOnce() {
        repeat(3) { queue.offer(frame()) }
        queue.offer(frame())
        assertEquals(1L, queue.dropped)
        assertEquals(1, asks)
        // the rest of the group would show garbage: dropped until the keyframe, with no second ask at once
        queue.offer(frame())
        queue.offer(frame())
        assertEquals(3L, queue.dropped)
        assertEquals(1, asks)
    }

    @Test
    fun whatWasDroppedStaysDroppedEvenWithRoomUntilAKeyframe() {
        repeat(4) { queue.offer(frame()) }
        queue.take()
        queue.take()
        val before = queue.dropped
        queue.offer(frame(id = 99))
        assertEquals(before + 1, queue.dropped)
        assertEquals(1, queue.size)
    }

    @Test
    fun aKeyframeClearsWhatItMakesWorthlessAndLetsFramesThroughAgain() {
        repeat(4) { queue.offer(frame()) }
        val before = queue.dropped
        queue.offer(key)
        assertEquals(before + 3, queue.dropped)
        assertTrue(queue.take()!!.isKey)
        queue.offer(frame(id = 7))
        assertEquals(7L, queue.take()!!.ptsUs)
    }

    @Test
    fun parameterSetsAreNeverDropped() {
        queue.offer(config)
        repeat(3) { queue.offer(frame()) }
        queue.offer(config)
        repeat(5) { queue.offer(frame()) }
        queue.offer(key)
        assertTrue(queue.take()!!.isConfig)
        assertTrue(queue.take()!!.isConfig)
        assertTrue(queue.take()!!.isKey)
    }

    @Test
    fun aKeyframeThatNeverComesIsAskedForAgain() {
        repeat(4) { queue.offer(frame()) }
        assertEquals(1, asks)
        time += StreamQueue.ASK_AGAIN_MS - 1
        queue.offer(frame())
        assertEquals(1, asks)
        time += 1
        queue.offer(frame())
        assertEquals(2, asks)
    }

    @Test
    fun itHoldsNoMoreThanItsSizeWhateverComes() {
        repeat(1_000) { queue.offer(frame()) }
        assertEquals(3, queue.size)
        assertEquals(997L, queue.dropped)
    }

    @Test
    fun aClosedQueueAnswersNothingAndTakesNothing() {
        queue.close()
        queue.offer(frame())
        assertNull(queue.take())
    }

    @Test
    fun aNewEncoderForgetsTheOldOnesFrames() {
        repeat(4) { queue.offer(frame()) }
        queue.restart()
        queue.offer(frame(id = 5))
        assertEquals(5L, queue.take()!!.ptsUs)
    }
}
