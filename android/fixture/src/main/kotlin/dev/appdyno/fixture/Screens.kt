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
import android.graphics.Canvas
import android.graphics.Paint
import android.widget.HorizontalScrollView
import android.widget.ScrollView
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
    "showcase" to ("Vitrin" to ShowcaseActivity::class.java),
)

/** Screens opened by link only (gdfixture://open/<key>): measurement fixtures. */
private val LINKED = mapOf(
    "frames" to FramesActivity::class.java,
    "memory" to MemoryActivity::class.java,
    "cpu" to CpuActivity::class.java,
    "late" to LateActivity::class.java,
    "code" to CodeActivity::class.java,
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
        // the start's "fully drawn" mark (time to full display) once the first frame is up
        window.decorView.post { reportFullyDrawn() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        route(intent)
    }

    private fun route(intent: Intent?) {
        val key = intent?.data?.lastPathSegment ?: return
        (SCREENS[key]?.second ?: LINKED[key])?.let { startActivity(Intent(this, it)) }
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
            // a text-input layout as Material draws one: a label above the field and helper text below,
            // so the layout's middle is not on its field (a tap there focuses nothing)
            LinearLayout(context).apply {
                id = R.id.gsm_layout
                orientation = LinearLayout.VERTICAL
                TextView(context).apply { text = "Cep telefonu"; addView(this) }
                EditText(context).apply {
                    id = R.id.gsm_input
                    inputType = InputType.TYPE_CLASS_PHONE
                    addView(this)
                }
                TextView(context).apply {
                    text = "Size bu numaradan ulaşacağız"
                    minHeight = 240
                    addView(this)
                }
                this@column.addView(this)
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
            this@TickerActivity.handler.post(object : Runnable {
                override fun run() {
                    ticker.text = "Kalan: ${left--}"
                    this@TickerActivity.handler.postDelayed(this, 100)
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

/**
 * A storefront home: a banner carousel that advances by itself every 2 s and eight rows of ten product
 * cards (name, price, an add button), a few hundred nodes like a real shop's home screen.
 */
class ShowcaseActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 96, 0, 32) }
        val banner = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val banners = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (i in 1..5) banners.addView(TextView(this).apply {
            text = "Kampanya $i"
            textSize = 22f
            setPadding(48, 96, 48, 96)
            layoutParams = LinearLayout.LayoutParams(1000, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        banner.addView(banners)
        page.addView(banner)
        val categories = listOf("Meyve", "Sebze", "Süt", "Kahvaltılık", "Atıştırmalık", "İçecek", "Temizlik", "Kişisel bakım")
        for ((c, category) in categories.withIndex()) {
            page.addView(TextView(this).apply { text = category; textSize = 20f; setPadding(32, 32, 32, 8) })
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 1..10) {
                val card = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16, 16, 16, 16) }
                card.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(220, 160); setBackgroundColor(0xFFEEE8FF.toInt()) })
                card.addView(TextView(this).apply { text = "$category ${c * 10 + i}" })
                card.addView(TextView(this).apply { text = "₺${(c * 10 + i) * 7},90" })
                card.addView(Button(this).apply { text = "Ekle" })
                row.addView(card)
            }
            page.addView(HorizontalScrollView(this).apply { addView(row) })
        }
        setContentView(ScrollView(this).apply { addView(page) })
        handler.postDelayed(object : Runnable {
            override fun run() {
                banner.smoothScrollBy(if (banner.scrollX > 3000) -4000 else 1000, 0)
                handler.postDelayed(this, 2_000)
            }
        }, 2_000)
    }
}

/**
 * Frames of a known cost: a 2 s animation redrawn every frame, its draw taking about 1 ms ("HAFİF") or
 * 40 ms ("AĞIR", every frame misses a 60 Hz deadline).
 */
class FramesActivity : Activity() {
    private class Animated(ctx: Activity) : View(ctx) {
        var costMs = 0L
        var until = 0L
        private val paint = Paint().apply { color = 0xFF5D3EBC.toInt() }
        override fun onDraw(canvas: Canvas) {
            val now = android.os.SystemClock.uptimeMillis()
            if (costMs > 0) Thread.sleep(costMs)
            canvas.drawRect(((now / 4) % width).toFloat(), 0f, ((now / 4) % width + 100).toFloat(), 200f, paint)
            if (now < until) postInvalidateOnAnimation()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val view = Animated(this@FramesActivity).apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 220) }
            fun run(cost: Long) {
                view.costMs = cost
                view.until = android.os.SystemClock.uptimeMillis() + 2_000
                view.postInvalidateOnAnimation()
            }
            button("Hafif", R.id.frames_light) { run(0) }
            button("Ağır", R.id.frames_heavy) { run(40) }
            addView(view)
        }
    }
}

/** Java heap held on purpose: 50 MB in 1 MB arrays, every page written; released on demand. */
class MemoryActivity : Activity() {
    companion object {
        val held = ArrayList<ByteArray>()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val status = label("Ayrılan: ${held.size} MB", R.id.memory_status)
            button("50 MB ayır", R.id.memory_alloc) {
                repeat(50) { held += ByteArray(1 shl 20).also { a -> for (i in a.indices step 4096) a[i] = 1 } }
                status.text = "Ayrılan: ${held.size} MB"
            }
            button("Bırak", R.id.memory_free) {
                held.clear()
                Runtime.getRuntime().gc()
                status.text = "Ayrılan: 0 MB"
            }
        }
    }
}

/** One core busy for 3 s on a background thread. */
class CpuActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            button("3 sn yük", R.id.cpu_load) {
                Thread {
                    val end = android.os.SystemClock.uptimeMillis() + 3_000
                    var x = 0L
                    // the clock is read rarely: the time goes to this loop, not to the clock
                    while (android.os.SystemClock.uptimeMillis() < end) repeat(100_000) { x += x xor 7 }
                    if (x == 42L) println(x)
                }.start()
            }
        }
    }
}

/**
 * Reactions that come late with nothing in between: a tap adds a line after the button's delay. A settle
 * that ends before the delay misses the change.
 */
class LateActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val handler = Handler(Looper.getMainLooper())
        column {
            val result = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; id = R.id.late_result }
            for (delay in listOf(0, 50, 100, 150, 200, 250, 300, 350, 450, 700, 1000)) {
                button("$delay ms", View.generateViewId()) {
                    handler.postDelayed({ result.addView(TextView(context).apply { text = "Tepki $delay" }) }, delay.toLong())
                }.tag = "late_$delay"
            }
            button("Temizle", R.id.late_clear) { result.removeAllViews() }
            // not clickable: only a touch listener reacts (as a gesture area does), 30 ms after the touch
            TextView(context).apply {
                text = "Dokunma alanı"
                id = R.id.late_touch
                setPadding(0, 48, 0, 48)
                setOnTouchListener { v, e ->
                    if (e.action == android.view.MotionEvent.ACTION_UP)
                        handler.postDelayed({ result.addView(TextView(context).apply { text = "Dokunuş tepkisi" }) }, 30)
                    true
                }
                addView(this)
            }
            addView(result)
        }
    }
}

/**
 * A code entry as login screens build it: four one-character fields, the next one focused after each
 * digit; the code so far is shown below. A code set into the first field at once does not fit.
 */
class CodeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Doğrulama kodu")
            val result = TextView(context).apply { id = R.id.result }
            val boxes = mutableListOf<EditText>()
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 0 until 4) {
                val box = EditText(context).apply {
                    tag = "code_box_$i"
                    contentDescription = if (i == 0) "Kod" else null
                    inputType = InputType.TYPE_CLASS_NUMBER
                    filters = arrayOf(android.text.InputFilter.LengthFilter(1))
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
                box.addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun afterTextChanged(e: android.text.Editable?) {
                        result.text = "Kod: " + boxes.joinToString("") { it.text.toString() }
                        if (!e.isNullOrEmpty() && i < 3) boxes[i + 1].requestFocus()
                    }
                })
                boxes.add(box)
                row.addView(box)
            }
            addView(row)
            addView(result)
            boxes[0].requestFocus()
        }
    }
}
