package dev.appdyno.agent

import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream

/**
 * The host wire: `[u32 BE payload length][u8 type][payload]`; type 0 is one JSON-RPC message (UTF-8),
 * type 1 a binary attachment `[u32 BE request id][bytes]` sent right before its JSON response; type 2 a
 * video frame of a stream `[u64 BE capture us][u64 BE sent ns][u32 BE flags][bytes]`, to the host only.
 */
const val FRAME_JSON = 0
const val FRAME_BINARY = 1
const val FRAME_VIDEO = 2
const val VIDEO_HEADER_BYTES = 20
const val MAX_FRAME_BYTES = 64 * 1024 * 1024

class FrameException(message: String) : Exception(message)

sealed class Frame {
    class Json(val text: String) : Frame()
    class Binary(val id: Int, val data: ByteArray) : Frame()
}

class FrameReader(input: InputStream) {
    private val inp = DataInputStream(input)

    /** The next frame, or null at a clean end of the stream. */
    fun read(): Frame? {
        val length = try {
            inp.readInt()
        } catch (e: EOFException) {
            return null
        }
        val type = inp.readUnsignedByte()
        if (length < 0 || length > MAX_FRAME_BYTES) throw FrameException("frame of $length bytes is over the limit")
        val payload = ByteArray(length)
        inp.readFully(payload)
        return when (type) {
            FRAME_JSON -> Frame.Json(String(payload, Charsets.UTF_8))

            FRAME_BINARY -> {
                if (length < 4) throw FrameException("a binary frame has no request id")
                Frame.Binary(readU32(payload, 0), payload.copyOfRange(4, length))
            }

            else -> throw FrameException("unknown frame type $type")
        }
    }
}

class FrameWriter(private val out: OutputStream) {
    @Synchronized
    fun json(text: String) {
        writeJson(text)
        out.flush()
    }

    /** An attachment and its response, never split by another response. */
    @Synchronized
    fun binaryThenJson(id: Int, data: ByteArray, text: String) {
        header(data.size + 4, FRAME_BINARY)
        out.write(u32(id))
        out.write(data)
        writeJson(text)
        out.flush()
    }

    @Synchronized
    fun video(frame: VideoFrame) {
        val head = java.nio.ByteBuffer.allocate(5 + VIDEO_HEADER_BYTES)
        val length = VIDEO_HEADER_BYTES + frame.data.size
        if (length > MAX_FRAME_BYTES) throw FrameException("frame of $length bytes is over the limit")
        head.putInt(length).put(FRAME_VIDEO.toByte())
        head.putLong(frame.ptsUs).putLong(frame.sentNanos).putInt(frame.flags)
        out.write(head.array())
        out.write(frame.data)
        out.flush()
    }

    private fun writeJson(text: String) {
        val payload = text.toByteArray(Charsets.UTF_8)
        header(payload.size, FRAME_JSON)
        out.write(payload)
    }

    private fun header(length: Int, type: Int) {
        if (length > MAX_FRAME_BYTES) throw FrameException("frame of $length bytes is over the limit")
        out.write(u32(length))
        out.write(type)
    }
}

internal fun u32(v: Int) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())

internal fun readU32(b: ByteArray, at: Int) = ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or
    ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)
