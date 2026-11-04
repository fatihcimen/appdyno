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

    companion object {
        const val RESTARTS = 3
        const val RESTART_PAUSE_MS = 500L
        const val RAN_WELL_MS = 10_000L
        val SIZES = listOf(2560, 1920, 1600, 1280, 1024, 800)
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
