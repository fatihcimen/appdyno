package dev.appdyno.fixture

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Choreographer
import android.widget.HorizontalScrollView
import android.widget.LinearLayout

/**
 * A banner that never stops: its cards run left a few pixels every frame and start again. Under it a count, a button
 * that adds to it and one that opens another screen: all but the banner is still until one of them is tapped.
 */
class BannerActivity : Activity() {
    private var added = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val cards = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            // a card is a control, as a shop's is: its place is the screen's layout, where a plain text's is not
            for (i in 1..8) cards.button("Kampanya $i") { }.apply { layoutParams = LinearLayout.LayoutParams(CARD_PX, 300) }
            val banner = HorizontalScrollView(context).apply {
                id = R.id.banner
                isHorizontalScrollBarEnabled = false
                addView(cards)
            }
            addView(banner)
            val count = label("Sepet: 0", R.id.banner_count)
            button("Add", R.id.banner_add) { count.text = "Sepet: ${++added}" }
            button("Details", R.id.banner_details) { startActivity(Intent(this@BannerActivity, LateActivity::class.java)) }
            Choreographer.getInstance().postFrameCallback(object : Choreographer.FrameCallback {
                override fun doFrame(frameTimeNanos: Long) {
                    if (isDestroyed) return
                    banner.scrollTo(if (banner.scrollX >= 5 * CARD_PX) 0 else banner.scrollX + STEP_PX, 0)
                    Choreographer.getInstance().postFrameCallback(this)
                }
            })
        }
    }

    private companion object {
        const val CARD_PX = 600
        const val STEP_PX = 6
    }
}
