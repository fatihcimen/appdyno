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
class StreamLadder(
    codec: String,
    displayMax: Int,
    askedMax: Int? = null,
    held: Int? = null,
    private val readable: Int = 0,
) {
    private val steps: List<EncoderStep>
    private var at = 0
    private val tooSlowUntil = HashMap<Int, Long>()

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
        if (held != null) at = steps.indexOfFirst { it.maxSize <= held }.coerceAtLeast(0)
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

    /** The sizes a person can still read below this one, largest first. */
    private fun readableBelow(): List<Int> {
        val now = current
        return steps.indices.drop(at + 1).filter { i ->
            val s = steps[i]
            s.mime == now.mime && !s.software && s.maxSize < now.maxSize && s.maxSize >= readable
        }
    }

    /** No size left that a person can read: a picture too slow here stays, and says so. */
    val atTheFloor get() = readableBelow().isEmpty()

    /**
     * A picture too slow for a person: the largest size of this codec that `ms` says will keep up, as what an encoder
     * takes goes with its pixels; where none will, the smallest that can still be read. Null where none is left. The
     * size it leaves is not tried again for a while, so that a load that stays costs a person one change.
     */
    fun smaller(ms: Long, nowMs: Long): EncoderStep? {
        val now = current
        val below = readableBelow()
        val next = below.firstOrNull { i ->
            val share = steps[i].maxSize.toDouble() / now.maxSize
            ms * share * share <= FITS_MS
        } ?: below.lastOrNull() ?: return null
        tooSlowUntil[now.maxSize] = nowMs + HOLD_OFF_MS
        at = next
        return steps[next]
    }

    private fun nextUp(): Int? {
        val now = current
        val size = steps.take(at).filter { it.mime == now.mime && it.software == now.software && it.maxSize > now.maxSize }
            .minOfOrNull { it.maxSize } ?: return null
        return steps.indexOfFirst { it.mime == now.mime && it.software == now.software && it.maxSize == size }
    }

    /**
     * The most a run may read here for the next size up to keep up, by the same rule of pixels; null at the top, or
     * while that size is held off. What was too slow under a load is tried again once the load has gone.
     */
    fun roomMs(nowMs: Long): Long? {
        val next = steps[nextUp() ?: return null]
        if (nowMs < (tooSlowUntil[next.maxSize] ?: 0)) return null
        val share = current.maxSize.toDouble() / next.maxSize
        return (EncoderPace.TOO_SLOW_MS * share * share).toLong()
    }

    fun larger(): EncoderStep? {
        at = nextUp() ?: return null
        return current
    }

    companion object {
        const val RESTARTS = 3

        /** Past `EncoderPace.TOO_SLOW_MS`, as a burst's first frames read more than it settles at: 150 ms for 67. */
        private const val FITS_MS = 50L
        const val HOLD_OFF_MS = 300_000L
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
class EncoderPace(private val roomMs: () -> Long? = { null }) {
    private val run = ArrayList<Long>()
    private var lastAtMs = 0L
    private var slowRuns = 0
    private var roomRuns = 0

    /** Runs in a row have been too slow. */
    val slow get() = slowRuns >= RUNS

    /** Runs in a row read that a larger size would keep up: one quiet moment is no proof. */
    val room get() = roomRuns >= ROOM_RUNS

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
        // asked at each run, as a size held off comes back while this encoder runs
        roomRuns = if (roomMs()?.let { middle <= it } == true) roomRuns + 1 else 0
        return middle.takeIf { slow }
    }

    companion object {
        const val FRAMES = 5
        const val RUNS = 2
        const val ROOM_RUNS = 3
        const val TOO_SLOW_MS = 40L
        private const val STILL_GAP_MS = 100L
        private const val MOST_MS = 2_000L
    }
}

/**
 * What a picture keeps of each dp of its screen, below which small text goes. In a window on a 914 dp screen, with text
 * at 9 sp, under the 11 of Material's smallest style: the Mac's Vision read 98 % of the words at 1.12 and 71 % at 0.88, and
 * an eye agrees. At 14 sp both read all of it, so a floor taken from body text alone would say nothing.
 */
private const val READABLE_PX_PER_DP = 1.12

/** The longest side below which a screen's small text cannot be read. */
fun readableSize(longest: Int, densityDpi: Int) = (longest * 160.0 / densityDpi * READABLE_PX_PER_DP).toInt()

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
