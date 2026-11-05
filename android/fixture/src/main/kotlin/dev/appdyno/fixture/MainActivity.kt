package dev.appdyno.fixture

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.FrameMetrics
import android.view.Window

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
    "frozen" to FrozenActivity::class.java,
    "battery" to BatteryActivity::class.java,
    "list_stall" to StallListActivity::class.java,
    "memory" to MemoryActivity::class.java,
    "cpu" to CpuActivity::class.java,
    "leak" to LeakActivity::class.java,
    "network" to NetworkActivity::class.java,
    "late" to LateActivity::class.java,
    "gestures" to GesturesActivity::class.java,
    "code" to CodeActivity::class.java,
    "a11y" to A11yActivity::class.java,
    "biometric" to BiometricActivity::class.java,
    "crash" to CrashActivity::class.java,
    "secure" to SecureActivity::class.java,
    "surface" to SurfaceActivity::class.java,
    "canvas" to CanvasActivity::class.java,
    "locale" to LocaleActivity::class.java,
)

/** The home screen; `appdyno-fixture://open/<screen>` opens a screen directly. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // a store's build starts in Compose: code run for the first time, which a Baseline Profile is for
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) {
            startActivity(Intent(this, ComposeStartActivity::class.java))
            finish()
            return
        }
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
