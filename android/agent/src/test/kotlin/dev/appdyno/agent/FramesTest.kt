package dev.appdyno.agent

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class FramesTest {
    @Test
    fun roundTripsJsonAndBinary() {
        val out = ByteArrayOutputStream()
        val w = FrameWriter(out)
        w.json("""{"id":1,"t":"İşğü"}""")
        w.binaryThenJson(7, byteArrayOf(0, 1, -1), """{"id":7}""")
        val r = FrameReader(ByteArrayInputStream(out.toByteArray()))
        assertEquals("""{"id":1,"t":"İşğü"}""", (r.read() as Frame.Json).text)
        val b = r.read() as Frame.Binary
        assertEquals(7, b.id)
        assertArrayEquals(byteArrayOf(0, 1, -1), b.data)
        assertEquals("""{"id":7}""", (r.read() as Frame.Json).text)
        assertNull(r.read())
    }

    @Test
    fun refusesOversizeAndUnknownType() {
        val big = u32(MAX_FRAME_BYTES + 1) + byteArrayOf(0)
        assertTrue(runCatching { FrameReader(ByteArrayInputStream(big)).read() }.exceptionOrNull() is FrameException)
        val unknown = u32(0) + byteArrayOf(9)
        assertTrue(runCatching { FrameReader(ByteArrayInputStream(unknown)).read() }.exceptionOrNull() is FrameException)
    }

    @Test
    fun errorCodesMatchTheHost() {
        assertEquals(-32000, rpcCode("TIMEOUT"))
        assertEquals(-32015, rpcCode("INTERNAL"))
        assertEquals(-32015, rpcCode("NOPE"))
        assertEquals(16, ERROR_CODES.size)
    }
}
