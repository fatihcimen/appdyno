package dev.appdyno.agent

/** A way to encode the screen. */
data class EncoderStep(val mime: String, val maxSize: Int, val software: Boolean, val note: String)

const val MIME_H264 = "video/avc"
const val MIME_HEVC = "video/hevc"

/**
 * What to try when an encoder fails, each step said in the stats: the same again a few times (an encoder
 * may refuse for a moment), then smaller, then the other codec, then software. (Pure, unit tested.) The
 * sizes follow what encoders on real phones refuse, as scrcpy's source shows; only the top step has run on
 * a phone that needed none of the others.
 */
class StreamLadder(codec: String, displayMax: Int, askedMax: Int? = null) {
    private val steps: List<EncoderStep>
    private var at = 0

    init {
        val top = minOf(askedMax ?: displayMax, displayMax)
        val sizes = listOf(top) + SIZES.filter { it < top }
        val first = if (codec == "hevc") MIME_HEVC else MIME_H264
        val other = if (codec == "hevc") MIME_H264 else MIME_HEVC
        steps = buildList {
            repeat(RESTARTS + 1) { add(EncoderStep(first, top, false, if (it == 0) "top" else "restarted $it")) }
            for (s in sizes.drop(1)) add(EncoderStep(first, s, false, "smaller: $s"))
            for (s in sizes) add(EncoderStep(other, s, false, "other codec: $s"))
            for (s in sizes) add(EncoderStep(first, s, true, "software: $s, up to its own bit rate"))
        }
    }

    val current: EncoderStep get() = steps[at]

    /**
     * After a failure: what to try next, or null when nothing is left. An encoder that ran well for a while
     * and then failed keeps its step: it is no sign that this step cannot work.
     */
    fun failed(ranMs: Long): EncoderStep? {
        if (ranMs >= RAN_WELL_MS) return current
        at++
        return steps.getOrNull(at)
    }

    /**
     * A picture too slow for a person: the largest size of this codec that `ms` says will keep up, as what an encoder
     * takes goes with its pixels. Null where none is left.
     */
    fun smaller(ms: Long): EncoderStep? {
        val now = current
        val fitting = steps.indices.drop(at + 1).firstOrNull { i ->
            val s = steps[i]
            val share = s.maxSize.toDouble() / now.maxSize
            s.mime == now.mime && !s.software && s.maxSize < now.maxSize && ms * share * share <= FITS_MS
        } ?: return null
        at = fitting
        return steps[fitting]
    }

    companion object {
        const val RESTARTS = 3

        /** Past `EncoderPace.TOO_SLOW_MS`, as a burst's first frames read more than it settles at: 150 ms for 67. */
        private const val FITS_MS = 50L
        const val RESTART_PAUSE_MS = 500L
        const val RAN_WELL_MS = 10_000L
        val SIZES = listOf(2560, 1920, 1600, 1280, 1024, 800)
    }
}

/**
 * Whether a picture's size keeps up with a person, by what the encoder itself took on the first run of motion: it wakes
 * slowly, and a touch on a still screen waits for exactly that. Only a run counts: a clock's tick or a ripple is a frame or
 * three, read 29 to 49 ms on a Samsung whose motion read 150, and a key frame says nothing, a Xiaomi's taking 96 ms at a
 * size it then held at 25. So this needs motion and no model's name. A size can hold its rate and still queue: a Samsung's
 * 2400 lines held 89 frames/s, each 69 ms late, and a touch took 217 ms to show.
 */
class EncoderPace {
    private val run = ArrayList<Long>()
    private var lastAtMs = 0L
    private var slowRuns = 0

    /**
     * A frame's time, and when it came; the middle of a run when runs in a row have been too slow. Each run is watched, as a
     * first one may be small and bless a size too large; one alone is no proof, so a stall costs no one their picture.
     */
    fun tooSlow(ms: Long, atMs: Long): Long? {
        if (ms !in 0..MOST_MS) return null
        if (atMs - lastAtMs > STILL_GAP_MS) run.clear()
        lastAtMs = atMs
        if (run.size == FRAMES) return null
        run += ms
        if (run.size < FRAMES) return null
        val middle = run.sorted()[FRAMES / 2]
        slowRuns = if (middle > TOO_SLOW_MS) slowRuns + 1 else 0
        return middle.takeIf { slowRuns >= RUNS }
    }

    companion object {
        const val FRAMES = 5
        const val RUNS = 2
        const val TOO_SLOW_MS = 40L
        private const val STILL_GAP_MS = 100L
        private const val MOST_MS = 2_000L
    }
}

/** How big a picture is for a screen and a longest side: even, as encoders need, and multiples of 8 when scaled. */
fun streamSize(w: Int, h: Int, maxSize: Int): Pair<Int, Int> {
    val longest = maxOf(w, h)
    if (longest <= maxSize) return (w and 1.inv()) to (h and 1.inv())
    val k = maxSize.toDouble() / longest
    return ((w * k).toInt() and 7.inv()) to ((h * k).toInt() and 7.inv())
}

/** 8 Mbit/s at a 720p screen, scaled by its pixels, then by the quality asked. */
fun streamBitRate(w: Int, h: Int, quality: String): Int {
    val base = 8_000_000.0 * w * h / (1280 * 720)
    val scaled = when (quality) {
        "high" -> base * 2
        "standard" -> base / 2
        else -> base
    }
    return scaled.toInt().coerceIn(1_000_000, 80_000_000)
}
