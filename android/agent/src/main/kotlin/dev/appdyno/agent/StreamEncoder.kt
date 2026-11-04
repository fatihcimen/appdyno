package dev.appdyno.agent

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.view.Surface

/** One encoder on one step of the ladder: made, run by its owner, released, whatever happened. */
class StreamEncoder(private val step: EncoderStep, w: Int, h: Int, fps: Float, quality: String) {
    private val codec: MediaCodec = create(step)
    val name: String get() = codec.name
    val surface: Surface
    private val info = MediaCodec.BufferInfo()
    private var buffer = ByteArray(1 shl 20)

    init {
        val caps = codec.codecInfo.getCapabilitiesForType(step.mime).videoCapabilities
        val format = MediaFormat.createVideoFormat(step.mime, w, h).apply {
            // a software codec has its own cap, and refuses more
            setInteger(MediaFormat.KEY_BIT_RATE, caps.bitrateRange.clamp(streamBitRate(w, h, quality)))
            setInteger(MediaFormat.KEY_FRAME_RATE, fps.toInt().coerceAtLeast(1))
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            // no frame is repeated: a still screen costs nothing, and a keyframe comes when one is asked for
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 10)
            setInteger(MediaFormat.KEY_PRIORITY, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            setInteger(MediaFormat.KEY_LATENCY, 1)
        }
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            surface = codec.createInputSurface()
        } catch (t: Throwable) {
            codec.release()
            throw t
        }
    }

    fun start() = codec.start()

    /** A frame if one came within the time; a failed encoder throws. */
    fun next(timeoutUs: Long): VideoFrame? {
        val i = codec.dequeueOutputBuffer(info, timeoutUs)
        if (i < 0) return null
        val out = codec.getOutputBuffer(i) ?: throw IllegalStateException("no buffer $i from ${codec.name}")
        out.position(info.offset)
        out.limit(info.offset + info.size)
        val bytes = ByteArray(info.size)
        out.get(bytes)
        val sentNanos = System.nanoTime()
        var flags = 0
        if (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0) flags = flags or VideoFrame.FLAG_KEY
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) flags = flags or VideoFrame.FLAG_CONFIG
        val ptsUs = info.presentationTimeUs
        codec.releaseOutputBuffer(i, false)
        return VideoFrame(ptsUs, sentNanos, flags, bytes)
    }

    fun requestKey() {
        codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
    }

    fun release() {
        // each is tried: a codec in a failed state refuses to stop, and must still be released
        runCatching { codec.stop() }
        runCatching { codec.release() }
        runCatching { surface.release() }
    }

    private fun create(step: EncoderStep): MediaCodec {
        if (!step.software) return MediaCodec.createEncoderByType(step.mime)
        val software = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull {
            it.isEncoder && step.mime in it.supportedTypes.map { t -> t.lowercase() } &&
                (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || it.isSoftwareOnly)
        } ?: throw IllegalStateException("no software encoder for ${step.mime}")
        return MediaCodec.createByCodecName(software.name)
    }
}
