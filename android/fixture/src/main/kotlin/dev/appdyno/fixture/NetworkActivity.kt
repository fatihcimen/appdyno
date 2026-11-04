package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.TextView
import java.net.URL

/** One request through the platform's own client, so that it takes the system proxy as an app does: the link's `url` at once, else what is typed. */
class NetworkActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val url = EditText(context).apply { id = R.id.url_input; hint = "URL"; inputType = InputType.TYPE_TEXT_VARIATION_URI; addView(this) }
            val result = TextView(context)
            fun fetch(address: String) = Thread {
                val text = try {
                    val c = URL(address).openConnection() as java.net.HttpURLConnection
                    val body = c.inputStream.use { it.readBytes() }
                    "fetched ${c.responseCode} ${body.size}"
                } catch (e: Exception) {
                    "failed: ${e.message}"
                }
                runOnUiThread { result.text = text }
            }.start()
            button("Fetch", R.id.fetch) { fetch(url.text.toString()) }
            result.id = R.id.fetch_result
            addView(result)
            intent.data?.getQueryParameter("url")?.let(::fetch)
        }
    }
}
