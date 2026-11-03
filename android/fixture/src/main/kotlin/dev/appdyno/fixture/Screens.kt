package dev.appdyno.fixture

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.FrameMetrics
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.unit.dp
import java.io.File
import java.net.URL

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
    "list" to ("List" to ListActivity::class.java),
    "dialog" to ("Dialog" to DialogActivity::class.java),
    "compose" to ("Compose" to ComposeActivity::class.java),
    "ticker" to ("Ticker" to TickerActivity::class.java),
    "delayed" to ("Delayed" to DelayedActivity::class.java),
    "permission" to ("Permission" to PermissionActivity::class.java),
    "slowfocus" to ("Slow focus" to SlowFocusActivity::class.java),
    "web" to ("Web" to WebActivity::class.java),
    "showcase" to ("Showcase" to ShowcaseActivity::class.java),
)

/** Screens opened by link only (appdyno-fixture://open/<key>): measurement fixtures. */
private val LINKED = mapOf(
    "frames" to FramesActivity::class.java,
    "list_stall" to StallListActivity::class.java,
    "memory" to MemoryActivity::class.java,
    "cpu" to CpuActivity::class.java,
    "leak" to LeakActivity::class.java,
    "network" to NetworkActivity::class.java,
    "late" to LateActivity::class.java,
    "gestures" to GesturesActivity::class.java,
    "code" to CodeActivity::class.java,
    "a11y" to A11yActivity::class.java,
)

/** A number a test wrote into the app's files, as a known cost; absent, none. */
private fun Context.costMs(name: String) = File(filesDir, name).takeIf { it.exists() }?.readText()?.trim()?.toLongOrNull()

/** A slow start of a known cost: `files/startup_ms` holds how long `onCreate` takes. */
class FixtureApp : Application() {
    override fun onCreate() {
        super.onCreate()
        costMs("startup_ms")?.let { Thread.sleep(it) }
    }
}

/** The home screen; `appdyno-fixture://open/<screen>` opens a screen directly. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("appdyno fixture", R.id.title)
            for (v in SCREENS.values) button(v.first) { startActivity(Intent(this@MainActivity, v.second)) }
            button("Crash") { throw IllegalStateException("fixture crash") }
            button("Freeze") { Thread.sleep(12_000) }
        }
        route(intent)
        // the start's "fully drawn" mark (time to full display) `files/ttfd_ms` after the first frame is up;
        // a post from here runs at the first traversal, a good 100 ms before that frame is on screen
        window.addOnFrameMetricsAvailableListener(object : Window.OnFrameMetricsAvailableListener {
            var seen = false
            override fun onFrameMetricsAvailable(w: Window, metrics: FrameMetrics, dropped: Int) {
                // frames delivered together each call this, also after the listener is gone
                if (seen) return
                seen = true
                w.removeOnFrameMetricsAvailableListener(this)
                w.decorView.postDelayed({ reportFullyDrawn() }, costMs("ttfd_ms") ?: 0)
            }
        }, Handler(Looper.getMainLooper()))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        route(intent)
    }

    private fun route(intent: Intent?) {
        val key = intent?.data?.lastPathSegment ?: return
        (SCREENS[key]?.second ?: LINKED[key])?.let { startActivity(Intent(this, it).setData(intent.data)) }
    }
}

class FormActivity : Activity() {
    // a device's password manager would offer to save the form over the next screens, importance flags or not
    override fun onPause() {
        getSystemService(android.view.autofill.AutofillManager::class.java)?.cancel()
        super.onPause()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Enter your details")
            val name = EditText(context).apply { id = R.id.name_input; hint = "Your name"; addView(this) }
            EditText(context).apply {
                id = R.id.phone_input
                hint = "Phone"
                inputType = InputType.TYPE_CLASS_PHONE
                addView(this)
            }
            // a text-input layout as Material draws one: a label above the field and helper text below,
            // so the layout's middle is not on its field (a tap there focuses nothing)
            LinearLayout(context).apply {
                id = R.id.gsm_layout
                orientation = LinearLayout.VERTICAL
                TextView(context).apply { text = "Mobile phone"; addView(this) }
                EditText(context).apply {
                    id = R.id.gsm_input
                    inputType = InputType.TYPE_CLASS_PHONE
                    addView(this)
                }
                TextView(context).apply {
                    text = "We will reach you at this number"
                    minHeight = 240
                    addView(this)
                }
                this@column.addView(this)
            }
            EditText(context).apply {
                id = R.id.password_input
                hint = "Password"
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                addView(this)
            }
            val result = TextView(context)
            button("Send", R.id.submit) { result.text = "Sent: ${name.text}" }
            result.id = R.id.result
            addView(result)
        }
    }
}

/** Says what a finger did on the pad: double taps, how far the last path went, how many fingers. */
class GesturesActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val out = label("double taps: 0")
            var doubles = 0
            var fingers = 0
            var travel = 0
            var startY = 0f
            val show = { out.text = "double taps: $doubles; travel: $travel; fingers: $fingers" }
            val detector = android.view.GestureDetector(context, object : android.view.GestureDetector.SimpleOnGestureListener() {
                override fun onDown(e: android.view.MotionEvent) = true
                override fun onDoubleTap(e: android.view.MotionEvent): Boolean {
                    doubles++
                    show()
                    return true
                }
            })
            View(context).apply {
                contentDescription = "Gesture pad"
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1400)
                setOnTouchListener { _, e ->
                    detector.onTouchEvent(e)
                    when (e.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> {
                            startY = e.y
                            fingers = 1
                        }
                        android.view.MotionEvent.ACTION_POINTER_DOWN -> fingers = maxOf(fingers, e.pointerCount)
                        android.view.MotionEvent.ACTION_UP -> {
                            travel = (e.y - startY).toInt()
                            show()
                        }
                    }
                    true
                }
                addView(this)
            }
        }
    }
}

open class ListActivity : Activity() {
    private val counts = IntArray(60)
    protected open val listId = R.id.list

    /** When a row comes into the list, for a screen that makes it cost something. */
    protected open fun onRow(position: Int) = Unit

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val list = ListView(this).apply { id = listId }
        list.adapter = object : BaseAdapter() {
            override fun getCount() = counts.size
            override fun getItem(position: Int) = position
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
                onRow(position)
                val row = LinearLayout(this@ListActivity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(24, 24, 24, 24) }
                TextView(this@ListActivity).apply {
                    id = R.id.row_name
                    text = "Product ${position + 1}"
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    row.addView(this)
                }
                val count = TextView(this@ListActivity).apply {
                    id = R.id.row_count
                    text = "In basket: ${counts[position]}"
                    row.addView(this)
                }
                Button(this@ListActivity).apply {
                    id = R.id.add_button
                    text = "Add"
                    setOnClickListener { counts[position]++; count.text = "In basket: ${counts[position]}" }
                    row.addView(this)
                }
                return row
            }
        }
        setContentView(list)
    }
}

/** Stalls once for 1 s as its rows come in: what a scroll's frozen frames must read. */
class StallListActivity : ListActivity() {
    override val listId = R.id.list_stall
    private var stalled = false

    override fun onRow(position: Int) {
        if (position == 20 && !stalled) {
            stalled = true
            Thread.sleep(1_000)
        }
    }
}

class DialogActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val result = TextView(context)
            button("Open dialog", R.id.open_dialog) {
                AlertDialog.Builder(this@DialogActivity)
                    .setTitle("Emin misiniz?")
                    .setMessage("The basket will be emptied.")
                    .setPositiveButton("OK") { _, _ -> result.text = "Confirmed" }
                    .setNegativeButton("Cancel") { _, _ -> result.text = "Cancelled" }
                    .show()
            }
            // a sheet as a login builds one: its own window, the field focused and the keyboard asked for as it
            // opens (typing goes into it with no tap; seen: the focus not found there, the number lost)
            button("Dialog with field", R.id.open_field_dialog) {
                val field = EditText(this@DialogActivity).apply {
                    id = R.id.sheet_input
                    hint = "Phone number"
                    inputType = InputType.TYPE_CLASS_PHONE
                }
                Dialog(this@DialogActivity).apply {
                    setContentView(LinearLayout(context).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(48, 48, 48, 48)
                        addView(TextView(context).apply { text = "Enter your phone number" })
                        addView(field)
                    })
                    window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                    setOnShowListener { field.requestFocus() }
                    show()
                }
            }
            // the same sheet on an app (or device) that answers nothing for 6 s before its field takes the focus:
            // a starved emulator froze 4 s while a login typed into its sheet, and the wait for the focus ran out
            button("Busy dialog", R.id.open_busy_dialog) {
                val field = EditText(this@DialogActivity).apply {
                    id = R.id.busy_input
                    hint = "Phone number"
                    inputType = InputType.TYPE_CLASS_PHONE
                }
                Dialog(this@DialogActivity).apply {
                    setContentView(field)
                    window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                    show()
                }
                field.post {
                    Thread.sleep(6_000)
                    field.requestFocus()
                }
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
            Column(Modifier.fillMaxSize().padding(16.dp)) {
                Text("Compose screen", Modifier.testTag("compose_title").padding(top = 32.dp))
                TextField(value = value, onValueChange = { value = it }, label = { Text("Not") }, modifier = Modifier.testTag("compose_input"))
                Button(onClick = { saved = value }, modifier = Modifier.testTag("compose_save")) { Text("Save") }
                Text(if (saved.isEmpty()) "Nothing saved" else "Saved: $saved", Modifier.testTag("compose_result"))
                LazyColumn(Modifier.testTag("compose_list")) {
                    items(50) { i -> Text("Row ${i + 1}", Modifier.testTag("row_$i").padding(12.dp)) }
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
            button("Stop", R.id.stop) { }
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
            for (i in 1..5) loaded.addView(Button(context).apply { text = "Result $i" })
            button("Load", R.id.load) {
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
            button("Request location", R.id.ask_permission) {
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
            label("Slow field")
            EditText(context).apply {
                id = R.id.slow_input
                hint = "Code"
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
        val web = WebView(this).apply { id = R.id.web; settings.javaScriptEnabled = true }
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
        val categories = listOf("Fruit", "Vegetables", "Milk", "Breakfast", "Snacks", "Drinks", "Cleaning", "Personal care")
        for ((c, category) in categories.withIndex()) {
            page.addView(TextView(this).apply { text = category; textSize = 20f; setPadding(32, 32, 32, 8) })
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 1..10) {
                val card = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16, 16, 16, 16) }
                card.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(220, 160); setBackgroundColor(0xFFEEE8FF.toInt()) })
                card.addView(TextView(this).apply { text = "$category ${c * 10 + i}" })
                card.addView(TextView(this).apply { text = "₺${(c * 10 + i) * 7},90" })
                card.addView(Button(this).apply { text = "Add" })
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
 * Frames of a known cost: a 2 s animation redrawn every frame, its draw taking about 1 ms ("LIGHT") or
 * 40 ms ("HEAVY", every frame misses a 60 Hz deadline).
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
            button("Light", R.id.frames_light) { run(0) }
            button("Heavy", R.id.frames_heavy) { run(40) }
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
            val status = label("Held: ${held.size} MB", R.id.memory_status)
            button("Hold 50 MB", R.id.memory_alloc) {
                repeat(50) { held += ByteArray(1 shl 20).also { a -> for (i in a.indices step 4096) a[i] = 1 } }
                status.text = "Held: ${held.size} MB"
            }
            button("Release", R.id.memory_free) {
                held.clear()
                Runtime.getRuntime().gc()
                status.text = "Held: 0 MB"
            }
        }
    }
}

/** One core busy for 3 s on a background thread. */
class CpuActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            button("Load 3 s", R.id.cpu_load) {
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

/** A leak of a known size: each open leaves one Activity alive after it closed itself. */
class LeakActivity : Activity() {
    companion object {
        val leaked = ArrayList<Activity>()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        leaked += this
        finish()
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
            button("Clear", R.id.late_clear) { result.removeAllViews() }
            // not clickable: only a touch listener reacts (as a gesture area does), 30 ms after the touch
            TextView(context).apply {
                text = "Touch area"
                id = R.id.late_touch
                setPadding(0, 48, 0, 48)
                setOnTouchListener { v, e ->
                    if (e.action == android.view.MotionEvent.ACTION_UP)
                        handler.postDelayed({ result.addView(TextView(context).apply { text = "Touch reaction" }) }, 30)
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
            label("Verification code")
            val result = TextView(context).apply { id = R.id.result }
            val boxes = mutableListOf<EditText>()
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 0 until 4) {
                val box = EditText(context).apply {
                    tag = "code_box_$i"
                    contentDescription = if (i == 0) "Code" else null
                    inputType = InputType.TYPE_CLASS_NUMBER
                    filters = arrayOf(android.text.InputFilter.LengthFilter(1))
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
                box.addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun afterTextChanged(e: android.text.Editable?) {
                        result.text = "Code: " + boxes.joinToString("") { it.text.toString() }
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

/**
 * Known accessibility problems, one of each, for the audit's device tests: faint text, a small target, an
 * unnamed icon button, a faint icon, two buttons read alike, text cut by its frame, ellipsized text (a
 * view's and Compose's), and a price read before the name above it (a traversal hint: the platform sorts
 * a view's children by place). "Continue" has none of them.
 */
class A11yActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val density = resources.displayMetrics.density
        fun px(v: Int) = (v * density).toInt()
        val white = android.graphics.Color.WHITE
        column {
            setBackgroundColor(white)
            label("Accessibility", R.id.title).setTextColor(android.graphics.Color.BLACK)
            label("Faint text", R.id.a11y_faint).setTextColor(android.graphics.Color.parseColor("#C8C8C8"))
            addView(View(context).apply {
                id = R.id.a11y_small
                contentDescription = "Small"
                setBackgroundColor(android.graphics.Color.parseColor("#1F3A93"))
                setOnClickListener {}
            }, LinearLayout.LayoutParams(px(24), px(24)))
            addView(android.widget.ImageButton(context).apply {
                id = R.id.a11y_icon
                setImageResource(android.R.drawable.ic_input_add)
                setOnClickListener {}
            }, LinearLayout.LayoutParams(px(56), px(56)))
            addView(android.widget.ImageView(context).apply {
                id = R.id.a11y_faint_icon
                contentDescription = "Faint icon"
                setImageDrawable(android.graphics.drawable.InsetDrawable(
                    android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.OVAL
                        setColor(android.graphics.Color.parseColor("#E2E2E2"))
                    },
                    px(12),
                ))
                setOnClickListener {}
            }, LinearLayout.LayoutParams(px(48), px(48)))
            button("Add", R.id.a11y_add_1) {}
            button("Add", R.id.a11y_add_2) {}
            // three lines of text in a frame one line tall
            addView(TextView(context).apply {
                id = R.id.a11y_cut
                text = "This text is too long for its frame and its lower lines do not show"
                textSize = 16f
                setTextColor(android.graphics.Color.BLACK)
            }, LinearLayout.LayoutParams(px(160), px(24)))
            addView(TextView(context).apply {
                id = R.id.a11y_ellipsized
                text = "Unmissable Prices and Deals of the Week"
                textSize = 16f
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(android.graphics.Color.BLACK)
            }, LinearLayout.LayoutParams(px(120), ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(androidx.compose.ui.platform.ComposeView(context).apply {
                setContent {
                    // in a column: the view's exact width would override the text's own
                    Column {
                        Text(
                            "A very long product name in Compose is cut here",
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            modifier = Modifier.width(120.dp),
                        )
                    }
                }
            })
            // the card's price is read first (a traversal hint), though it sits below the name
            addView(android.widget.FrameLayout(context).apply {
                id = R.id.a11y_card
                addView(TextView(context).apply {
                    id = R.id.a11y_price
                    text = "24,90 TL"
                    accessibilityTraversalBefore = R.id.a11y_name
                    setTextColor(android.graphics.Color.BLACK)
                }, android.widget.FrameLayout.LayoutParams(-2, -2).apply { topMargin = px(32) })
                addView(TextView(context).apply {
                    id = R.id.a11y_name
                    text = "Ayran 1 L"
                    setTextColor(android.graphics.Color.BLACK)
                }, android.widget.FrameLayout.LayoutParams(-2, -2))
            }, LinearLayout.LayoutParams(px(200), px(64)))
            button("Continue", R.id.a11y_ok) {}
        }
    }
}
