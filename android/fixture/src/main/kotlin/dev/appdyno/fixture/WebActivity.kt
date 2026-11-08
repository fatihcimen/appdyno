package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import androidx.compose.foundation.layout.width

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
        setContentView(web)
    }
}
