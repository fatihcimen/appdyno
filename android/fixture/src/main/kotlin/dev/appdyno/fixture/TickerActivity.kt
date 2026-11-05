package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/** A countdown that never stops: the screen is settled though a text keeps changing. */
class TickerActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var remaining = 100_000

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val ticker = label("", R.id.ticker)
            button("Stop", R.id.stop) { }
            this@TickerActivity.handler.post(object : Runnable {
                override fun run() {
                    // named apart from `left`: in here that is the column's own edge, and it would walk off the screen
                    ticker.text = "Kalan: ${remaining--}"
                    this@TickerActivity.handler.postDelayed(this, 100)
                }
            })
        }
    }
}
