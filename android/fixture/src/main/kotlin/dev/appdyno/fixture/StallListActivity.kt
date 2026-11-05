package dev.appdyno.fixture

/** Each frame costs 40 ms of the main thread while it shows: what a scroll's frames must read, and a profile name. */
class HeavyListActivity : ListActivity() {
    private fun heavyFrame() {
        val end = android.os.SystemClock.uptimeMillis() + 40
        var x = 0L
        while (android.os.SystemClock.uptimeMillis() < end) repeat(10_000) { x += x xor 3 }
        if (x == 42L) println(x)
    }

    private val eachFrame = object : android.view.Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            heavyFrame()
            if (!isDestroyed) android.view.Choreographer.getInstance().postFrameCallback(this)
        }
    }

    override fun onResume() {
        super.onResume()
        android.view.Choreographer.getInstance().postFrameCallback(eachFrame)
    }

    override fun onPause() {
        super.onPause()
        android.view.Choreographer.getInstance().removeFrameCallback(eachFrame)
    }
}

/** Stalls once for 1 s as its rows come in: what a scroll's frozen frames must read. */
class StallListActivity : ListActivity() {
    override val listId = R.id.list_stall
    private var stalled = false

    override fun onRow(position: Int) {
        if (position == 20 && !stalled) {
            stalled = true
            Thread.sleep(1_000)
        }
    }
}
