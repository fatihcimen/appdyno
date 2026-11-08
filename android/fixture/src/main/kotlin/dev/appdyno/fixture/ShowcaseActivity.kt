package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * A storefront home: a banner carousel that advances by itself every 2 s and eight rows of ten product
 * cards (name, price, an add button), a few hundred nodes like a real shop's home screen.
 */
class ShowcaseActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 96, 0, 32)
        }
        val banner = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val banners = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (i in 1..5) {
            banners.addView(
                TextView(this).apply {
                    text = "Kampanya $i"
                    textSize = 22f
                    setPadding(48, 96, 48, 96)
                    layoutParams = LinearLayout.LayoutParams(1000, ViewGroup.LayoutParams.WRAP_CONTENT)
                },
            )
        }
        banner.addView(banners)
        page.addView(banner)
        val categories = listOf("Fruit", "Vegetables", "Milk", "Breakfast", "Snacks", "Drinks", "Cleaning", "Personal care")
        for ((c, category) in categories.withIndex()) {
            page.addView(
                TextView(this).apply {
                    text = category
                    textSize = 20f
                    setPadding(32, 32, 32, 8)
                },
            )
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 1..10) {
                val card = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(16, 16, 16, 16)
                }
                card.addView(
                    View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(220, 160)
                        setBackgroundColor(0xFFEEE8FF.toInt())
                    },
                )
                card.addView(TextView(this).apply { text = "$category ${c * 10 + i}" })
                card.addView(TextView(this).apply { text = "₺${(c * 10 + i) * 7},90" })
                card.addView(Button(this).apply { text = "Add" })
                row.addView(card)
            }
            page.addView(HorizontalScrollView(this).apply { addView(row) })
        }
        setContentView(ScrollView(this).apply { addView(page) })
        handler.postDelayed(
            object : Runnable {
                override fun run() {
                    banner.smoothScrollBy(if (banner.scrollX > 3000) -4000 else 1000, 0)
                    handler.postDelayed(this, 2_000)
                }
            },
            2_000,
        )
    }
}
