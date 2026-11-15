package dev.appdyno.fixture

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.WebView
import android.widget.FrameLayout

class WebActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this).apply {
            id = R.id.web
            settings.javaScriptEnabled = true
        }
        web.loadDataWithBaseURL(
            null,
            "<html><head><title>Fixture web</title></head><body><h1>Web content</h1><p>Payment page</p><button id='pay' onclick=\"document.getElementById('paid').textContent='Paid'\">Pay</button><input id='card' placeholder='Card'><p id='paid'></p><canvas id='drawn' width='10' height='10'></canvas><script>console.log('fixture web page loaded')</script></body></html>",
            "text/html",
            "utf-8",
            null,
        )
        // Android 15 draws an app of target 35 and up under the system bars: the page's heading sat under the status bar
        val page = FrameLayout(this).apply {
            addView(web)
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                }
                insets
            }
        }
        setContentView(page)
    }
}
