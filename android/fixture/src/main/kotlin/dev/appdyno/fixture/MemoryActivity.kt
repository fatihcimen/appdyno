package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import androidx.core.graphics.createBitmap

/** Java heap held on purpose: 50 MB in 1 MB arrays, every page written; released on demand. */
class MemoryActivity : Activity() {
    companion object {
        val held = ArrayList<ByteArray>()
        var native: java.nio.ByteBuffer? = null
        var bitmap: android.graphics.Bitmap? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val status = label("Held: ${held.size} MB", R.id.memory_status)
            button("Hold 50 MB", R.id.memory_alloc) {
                repeat(50) { held += ByteArray(1 shl 20).also { a -> for (i in a.indices step 4096) a[i] = 1 } }
                status.text = "Held: ${held.size} MB"
            }
            button("Hold 50 MB native", R.id.memory_native) {
                native = java.nio.ByteBuffer.allocateDirect(50 shl 20).also { b -> for (i in 0 until b.capacity() step 4096) b.put(i, 1) }
                status.text = "Held native"
            }
            button("Hold 50 MB bitmap", R.id.memory_bitmap) {
                // 4 bytes a pixel: 50 MB, and every pixel written
                bitmap = createBitmap(3621, 3621, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF112233.toInt()) }
                status.text = "Held bitmap"
            }
            button("Release", R.id.memory_free) {
                held.clear()
                native = null
                bitmap?.recycle()
                bitmap = null
                Runtime.getRuntime().gc()
                status.text = "Held: 0 MB"
            }
        }
    }
}
