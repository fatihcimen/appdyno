package dev.appdyno.fixture

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * A page that moves on by itself 300 ms after it appears (and `files/moves_on_ms` in place of that), each time, as an
 * app opens a page it wants filled first: a back from that page lands here, and this opens it again.
 */
class MovesOnActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val onward = Runnable { startActivity(Intent(this, OnwardActivity::class.java)) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Start", R.id.title)
            button("Begin", R.id.begin_button) { }
        }
    }

    override fun onResume() {
        super.onResume()
        handler.postDelayed(onward, costMs("moves_on_ms") ?: MOVES_ON_MS)
    }

    override fun onPause() {
        handler.removeCallbacks(onward)
        super.onPause()
    }

    private companion object {
        const val MOVES_ON_MS = 300L
    }
}

/** The page `MovesOnActivity` moves on to. */
class OnwardActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Details", R.id.title)
            button("Done") { finish() }
        }
    }
}
