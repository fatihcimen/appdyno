package dev.appdyno.agent

import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** What a stream was asked for. */
class StreamRequest(val codec: String, val quality: String, val maxSize: Int?, val failFirst: Int) {
    companion object {
        fun from(p: JSONObject) = StreamRequest(
            codec = p.optString("codec", "h264"),
            quality = p.optString("quality", "auto"),
            maxSize = p.optInt("maxSize", 0).takeIf { it > 0 },
            failFirst = p.optInt("failFirst", 0),
        )
    }
}

/** Where a stream's frames and its news go: the connection that asked for it. */
interface StreamOutput {
    fun video(frame: VideoFrame)
    fun info(params: JSONObject)
    /** The stream will not go on, and why. */
    fun end(why: String)
}

/**
 * The screen as encoded frames, for as long as its connection lasts. One thread runs the encoder and one
 * writes, with a small queue between them, so that a slow host costs frames and never delay. The display
 * and the codec are released however it ends.
 */
class Stream(private val request: StreamRequest, private val out: StreamOutput) {
    private val stopped = AtomicBoolean(false)
    private val queue = StreamQueue(now = { SystemClock.uptimeMillis() }, askForKey = { keyWanted = true })

    @Volatile
    private var keyWanted = false
    private var failuresLeft = request.failFirst
    private val encoderThread = Thread({ encodeAll() }, "appdyno-stream-encoder")
    private val writerThread = Thread({ writeAll() }, "appdyno-stream-writer")

    @Volatile
    var mode: String = "starting"
        private set

    val dropped get() = queue.dropped

    fun start() {
        encoderThread.isDaemon = true
        writerThread.isDaemon = true
        encoderThread.start()
        writerThread.start()
    }

    /** A fresh keyframe, after a loss or a decoder's failure. */
    fun requestKey() {
        keyWanted = true
    }

    fun stop() {
        if (!stopped.compareAndSet(false, true)) return
        queue.close()
        encoderThread.interrupt()
        writerThread.interrupt()
        encoderThread.join(JOIN_MS)
        writerThread.join(JOIN_MS)
    }

    private fun writeAll() {
        try {
            while (!stopped.get()) out.video(queue.take() ?: return)
        } catch (_: InterruptedException) {
            // stopping
        } catch (e: Throwable) {
            System.err.println("stream write failed: $e")
            queue.close()
        }
    }

    private fun encodeAll() {
        if (Looper.myLooper() == null) Looper.prepare()
        val top = Platform.display()
        val ladder = StreamLadder(request.codec, maxOf(top.width, top.height), request.maxSize)
        var step: EncoderStep? = ladder.current
        var lastFailure = ""
        while (!stopped.get() && step != null) {
            val started = SystemClock.uptimeMillis()
            try {
                runEncoder(step)
                // a new size or rotation: the same step, at once
                continue
            } catch (_: InterruptedException) {
                return
            } catch (t: Throwable) {
                if (stopped.get()) return
                lastFailure = t.cause?.toString() ?: t.toString()
                System.err.println("encoder failed on ${step.note}: $lastFailure")
            }
            step = ladder.failed(SystemClock.uptimeMillis() - started)
            if (step != null) {
                try {
                    Thread.sleep(StreamLadder.RESTART_PAUSE_MS)
                } catch (_: InterruptedException) {
                    return
                }
            }
        }
        if (!stopped.get()) out.end("no encoder took this display: $lastFailure")
    }

    /** One encoder until it fails, is stopped, or the screen changes shape. */
    private fun runEncoder(step: EncoderStep) {
        val screen = Platform.display()
        val (w, h) = streamSize(screen.width, screen.height, step.maxSize)
        if (failuresLeft > 0) {
            failuresLeft--
            throw IllegalStateException("failing as the request asked")
        }
        val encoder = StreamEncoder(step, w, h, Platform.refreshRate(), request.quality)
        var mirror: DisplayMirror? = null
        try {
            mirror = DisplayMirror.create(w, h, screen, encoder.surface)
            encoder.start()
            queue.restart()
            mode = "${encoder.name} ${step.note}, ${mirror.how}"
            out.info(
                JSONObject()
                    .put("w", w)
                    .put("h", h)
                    .put("codec", if (step.mime == MIME_HEVC) "hevc" else "h264")
                    .put("mode", mode),
            )
            var checkedAt = SystemClock.uptimeMillis()
            while (!stopped.get()) {
                if (keyWanted) {
                    keyWanted = false
                    encoder.requestKey()
                }
                encoder.next(POLL_US)?.let { queue.offer(it) }
                val now = SystemClock.uptimeMillis()
                if (now - checkedAt >= SHAPE_CHECK_MS) {
                    checkedAt = now
                    val shape = Platform.display()
                    if (shape.width != screen.width || shape.height != screen.height) return
                }
            }
        } finally {
            runCatching { mirror?.release() }
            encoder.release()
        }
    }

    companion object {
        private const val POLL_US = 50_000L
        /** A rotation or fold is seen within this; asked by a timer, as listeners differ from release to release. */
        private const val SHAPE_CHECK_MS = 100L
        private const val JOIN_MS = 3_000L
    }
}

/** This agent's streams, one per connection that asked. */
class Streams {
    private val active = ConcurrentHashMap.newKeySet<Stream>()

    fun start(request: StreamRequest, out: StreamOutput): Stream {
        val s = Stream(request, out)
        active += s
        s.start()
        return s
    }

    fun end(stream: Stream) {
        stream.stop()
        active -= stream
    }

    fun requestKey() = active.forEach { it.requestKey() }

    fun status(): JSONObject = Platform.display().let { d ->
        JSONObject()
        .put("active", active.size)
        .put("on", d.on)
        .put("w", d.width)
        .put("h", d.height)
        .put("rotation", d.rotation)
        .put("modes", org.json.JSONArray(active.map { it.mode }))
        .put("dropped", active.sumOf { it.dropped })
    }
}

/** A stream's end of a connection. */
class ConnectionOutput(private val writer: FrameWriter) : StreamOutput {
    override fun video(frame: VideoFrame) = writer.video(frame)

    override fun info(params: JSONObject) = notify("stream.info", params)

    override fun end(why: String) = notify("stream.end", JSONObject().put("why", why))

    private fun notify(method: String, params: JSONObject) {
        // the socket may be gone: the connection's own thread finds that out and ends the stream
        runCatching { writer.json(JSONObject().put("method", method).put("params", params).toString()) }
    }
}
