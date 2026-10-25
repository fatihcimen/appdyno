package dev.appdyno.fixture

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp

private fun Activity.column(build: LinearLayout.() -> Unit): LinearLayout =
    LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(32, 96, 32, 32)
        build()
        setContentView(this)
    }

private fun LinearLayout.label(text: String, viewId: Int = View.NO_ID) =
    TextView(context).apply {
        this.text = text
        textSize = 18f
        id = viewId
        addView(this)
    }

private fun LinearLayout.button(text: String, viewId: Int = View.NO_ID, onClick: () -> Unit) =
    Button(context).apply {
        this.text = text
        id = viewId
        setOnClickListener { onClick() }
        addView(this)
    }

private val SCREENS = linkedMapOf(
    "form" to ("Form" to FormActivity::class.java),
    "list" to ("Liste" to ListActivity::class.java),
    "dialog" to ("Diyalog" to DialogActivity::class.java),
    "compose" to ("Compose" to ComposeActivity::class.java),
    "ticker" to ("Sayaç" to TickerActivity::class.java),
    "delayed" to ("Gecikmeli" to DelayedActivity::class.java),
    "permission" to ("İzin" to PermissionActivity::class.java),
    "slowfocus" to ("Yavaş odak" to SlowFocusActivity::class.java),
    "web" to ("Web" to WebActivity::class.java),
)

/** The home screen; `gdfixture://open/<screen>` opens a screen directly. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("appdyno fixture", R.id.title)
            for (v in SCREENS.values) button(v.first) { startActivity(Intent(this@MainActivity, v.second)) }
            button("Çökert") { throw IllegalStateException("fixture crash") }
            button("Donmuş") { Thread.sleep(12_000) }
        }
        route(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        route(intent)
    }

    private fun route(intent: Intent?) {
        val key = intent?.data?.lastPathSegment ?: return
        SCREENS[key]?.let { startActivity(Intent(this, it.second)) }
    }
}

class FormActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Bilgilerinizi girin")
            val name = EditText(context).apply { id = R.id.name_input; hint = "Adınız"; addView(this) }
            EditText(context).apply {
                id = R.id.phone_input
                hint = "Telefon"
                inputType = InputType.TYPE_CLASS_PHONE
                addView(this)
            }
            EditText(context).apply {
                id = R.id.password_input
                hint = "Şifre"
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                addView(this)
            }
            val result = TextView(context)
            button("Gönder", R.id.submit) { result.text = "Gönderildi: ${name.text}" }
            result.id = R.id.result
            addView(result)
        }
    }
}

class ListActivity : Activity() {
    private val counts = IntArray(60)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val list = ListView(this).apply { id = R.id.list }
        list.adapter = object : BaseAdapter() {
            override fun getCount() = counts.size
            override fun getItem(position: Int) = position
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
                val row = LinearLayout(this@ListActivity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(24, 24, 24, 24) }
                TextView(this@ListActivity).apply {
                    id = R.id.row_name
                    text = "Ürün ${position + 1}"
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    row.addView(this)
                }
                val count = TextView(this@ListActivity).apply {
                    id = R.id.row_count
                    text = "Sepette: ${counts[position]}"
                    row.addView(this)
                }
                Button(this@ListActivity).apply {
                    id = R.id.add_button
                    text = "Ekle"
                    setOnClickListener { counts[position]++; count.text = "Sepette: ${counts[position]}" }
                    row.addView(this)
                }
                return row
            }
        }
        setContentView(list)
    }
}

class DialogActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val result = TextView(context)
            button("Diyaloğu aç", R.id.open_dialog) {
                AlertDialog.Builder(this@DialogActivity)
                    .setTitle("Emin misiniz?")
                    .setMessage("Sepet boşaltılacak.")
                    .setPositiveButton("Tamam") { _, _ -> result.text = "Onaylandı" }
                    .setNegativeButton("İptal") { _, _ -> result.text = "Vazgeçildi" }
                    .show()
            }
            result.id = R.id.result
            addView(result)
        }
    }
}

class ComposeActivity : ComponentActivity() {
    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            var value by remember { mutableStateOf("") }
            var saved by remember { mutableStateOf("") }
            Column(Modifier.fillMaxSize().padding(16.dp).semantics { testTagsAsResourceId = true }) {
                Text("Compose ekranı", Modifier.testTag("compose_title").padding(top = 32.dp))
                TextField(value = value, onValueChange = { value = it }, label = { Text("Not") }, modifier = Modifier.testTag("compose_input"))
                Button(onClick = { saved = value }, modifier = Modifier.testTag("compose_save")) { Text("Kaydet") }
                Text(if (saved.isEmpty()) "Kayıt yok" else "Kaydedildi: $saved", Modifier.testTag("compose_result"))
                LazyColumn(Modifier.testTag("compose_list")) {
                    items(50) { i -> Text("Satır ${i + 1}", Modifier.testTag("row_$i").padding(12.dp)) }
                }
            }
        }
    }
}

/** A countdown that never stops: the screen is settled though a text keeps changing. */
class TickerActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var left = 100_000

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val ticker = label("", R.id.ticker)
            button("Dur", R.id.stop) { }
            handler.post(object : Runnable {
                override fun run() {
                    ticker.text = "Kalan: ${left--}"
                    handler.postDelayed(this, 100)
                }
            })
        }
    }
}

/** Content that arrives 600 ms after the tap, with a fade (the settle must wait for it). */
class DelayedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val progress = ProgressBar(context).apply { visibility = View.GONE; addView(this) }
            val loaded = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; id = R.id.loaded; visibility = View.GONE }
            for (i in 1..5) loaded.addView(Button(context).apply { text = "Sonuç $i" })
            button("Yükle", R.id.load) {
                progress.visibility = View.VISIBLE
                Handler(Looper.getMainLooper()).postDelayed({
                    progress.visibility = View.GONE
                    loaded.alpha = 0f
                    loaded.visibility = View.VISIBLE
                    loaded.animate().alpha(1f).setDuration(400).start()
                }, 600)
            }
            addView(loaded)
        }
    }
}

class PermissionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            button("Konum izni iste", R.id.ask_permission) {
                requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1)
            }
        }
    }
}

/** A field that takes focus only 700 ms after it was tapped (a slow phone). */
class SlowFocusActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Yavaş alan")
            EditText(context).apply {
                id = R.id.slow_input
                hint = "Kod"
                isFocusableInTouchMode = false
                setOnClickListener {
                    postDelayed({
                        isFocusableInTouchMode = true
                        requestFocus()
                    }, 700)
                }
                addView(this)
            }
        }
    }
}

class WebActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this).apply { id = R.id.web }
        web.loadDataWithBaseURL(
            null,
            "<html><body><h1>Web içerik</h1><p>Ödeme sayfası</p><button>Öde</button><input placeholder='Kart'></body></html>",
            "text/html",
            "utf-8",
            null,
        )
        setContentView(web)
    }
}
