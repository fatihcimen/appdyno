package dev.appdyno.fixture

import android.app.Activity
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.view.View

/** Words that are only a picture, as a game has them: nothing of them is in the tree. A touch changes them. */
class CanvasActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(object : View(this) {
            private var said = "Start Game"
            private val paint = Paint().apply {
                textSize = 96f
                color = Color.BLACK
                isAntiAlias = true
            }

            init {
                importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
                setOnClickListener {
                    said = "Game Over"
                    invalidate()
                }
            }

            override fun onDraw(canvas: Canvas) {
                canvas.drawColor(Color.WHITE)
                canvas.drawText(said, 240f, 900f, paint)
            }
        })
    }
}
