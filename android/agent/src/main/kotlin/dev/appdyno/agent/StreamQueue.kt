package dev.appdyno.agent

/** One encoded frame on its way to the host. `flags`: what the host needs of it. */
class VideoFrame(val ptsUs: Long, val sentNanos: Long, val flags: Int, val data: ByteArray) {
    val isKey get() = flags and FLAG_KEY != 0
    val isConfig get() = flags and FLAG_CONFIG != 0

    companion object {
        const val FLAG_KEY = 1
        const val FLAG_CONFIG = 2
    }
}

/**
 * Between the encoder and the socket: a few frames and no more, so that delay cannot grow. With the socket
 * full a frame is dropped, and then every frame up to the next keyframe, as a frame missing its reference
 * shows garbage: the picture freezes for a moment and is never wrong. (Pure, unit tested.)
 */
class StreamQueue(
    private val capacity: Int = 3,
    private val now: () -> Long,
    /** Asked when a keyframe is the way out; again if none came after [ASK_AGAIN_MS]. */
    private val askForKey: () -> Unit,
) {
    private val frames = ArrayDeque<VideoFrame>()
    private var awaitingKey = false
    private var askedAt = 0L
    private var closed = false

    @Volatile
    var dropped = 0L
        private set

    val size: Int
        @Synchronized get() = frames.size

    @Synchronized
    fun offer(frame: VideoFrame) {
        if (closed) return
        when {
            // parameter sets are never in the way, and without them nothing after can be decoded
            frame.isConfig -> frames.addLast(frame)

            frame.isKey -> {
                dropped += frames.count { !it.isConfig }
                frames.removeAll { !it.isConfig }
                awaitingKey = false
                frames.addLast(frame)
            }

            awaitingKey -> {
                dropped++
                if (now() - askedAt >= ASK_AGAIN_MS) ask()
            }

            frames.count { !it.isConfig } >= capacity -> {
                dropped++
                awaitingKey = true
                ask()
            }

            else -> frames.addLast(frame)
        }
        (this as Object).notifyAll()
    }

    private fun ask() {
        askedAt = now()
        askForKey()
    }

    /** The next frame; null once closed. */
    @Synchronized
    fun take(): VideoFrame? {
        while (frames.isEmpty() && !closed) (this as Object).wait()
        return frames.removeFirstOrNull()
    }

    @Synchronized
    fun close() {
        closed = true
        frames.clear()
        (this as Object).notifyAll()
    }

    /** A new encoder starts with a keyframe of its own: nothing before it matters. */
    @Synchronized
    fun restart() {
        frames.clear()
        awaitingKey = false
    }

    companion object {
        const val ASK_AGAIN_MS = 500L
    }
}
