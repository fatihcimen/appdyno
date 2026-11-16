package dev.appdyno.fixture

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Rect
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.widget.TextView
import java.lang.reflect.Proxy

/** How many of these this process has made: a fold that swaps the display makes one anew, unless the activity takes the change. */
private var created = 0

private const val HALF_OPENED = 2
private const val MEDIUM_DP = 600
private const val EXPANDED_DP = 840
private const val MEDIUM_HIGH_DP = 480
private const val EXPANDED_HIGH_DP = 900
private const val CONSUMER = "androidx.window.extensions.core.util.function.Consumer"

/** A window's size class by Material's breakpoints. */
private fun sizeClass(dp: Int, medium: Int, expanded: Int) = when {
    dp < medium -> "compact"
    dp < expanded -> "medium"
    else -> "expanded"
}

/**
 * What a fold changes for an app, as the app itself reads it: its window's size and size class, the posture the system's
 * window extensions tell (flat, or half opened as a tabletop or a book), the hinge's angle, and how many times the
 * activity was made.
 */
open class FoldActivity :
    Activity(),
    SensorEventListener {
    private lateinit var size: TextView
    private lateinit var sizeClass: TextView
    private lateinit var posture: TextView
    private lateinit var hinge: TextView
    private var layoutComponent: Any? = null
    private var layoutListener: Any? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        created++
        column {
            label("Created $created", R.id.fold_created)
            size = label("", R.id.fold_window)
            sizeClass = label("", R.id.fold_size_class)
            posture = label("Posture: unknown", R.id.fold_posture)
            hinge = label("Hinge angle: none", R.id.fold_hinge)
        }
        showWindow()
        watchLayout()
    }

    /** Only an activity that declares it takes the change gets here: any other is made anew. */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        showWindow()
    }

    private fun showWindow() {
        val c = resources.configuration
        val px = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            windowManager.currentWindowMetrics.bounds.let { "${it.width()}x${it.height()}" }
        } else {
            resources.displayMetrics.let { "${it.widthPixels}x${it.heightPixels}" }
        }
        size.text = "Window $px px, ${c.screenWidthDp}x${c.screenHeightDp} dp"
        val wide = sizeClass(c.screenWidthDp, MEDIUM_DP, EXPANDED_DP)
        val high = sizeClass(c.screenHeightDp, MEDIUM_HIGH_DP, EXPANDED_HIGH_DP)
        sizeClass.text = "Size class: $wide wide, $high high"
    }

    /**
     * The fold in this window, from the device's own window extensions, a library a device has or has not: found by
     * name, so that the app depends on nothing for it.
     */
    private fun watchLayout() {
        runCatching {
            val extensions = Class.forName("androidx.window.extensions.WindowExtensionsProvider")
                .getMethod("getWindowExtensions")
                .invoke(null)!!
            val component = extensions.javaClass.getMethod("getWindowLayoutComponent").invoke(extensions)!!
            val consumer = Class.forName(CONSUMER)
            val listener = Proxy.newProxyInstance(consumer.classLoader, arrayOf(consumer)) { proxy, method, args ->
                when (method.name) {
                    "accept" -> runOnUiThread { posture.text = "Posture: ${postureOf(args[0])}" }
                    "hashCode" -> System.identityHashCode(proxy)
                    "equals" -> proxy === args[0]
                    else -> "fold listener"
                }
            }
            component.javaClass
                .getMethod("addWindowLayoutInfoListener", Context::class.java, consumer)
                .invoke(component, this, listener)
            layoutComponent = component
            layoutListener = listener
        }.onFailure { posture.text = "Posture: unknown, this device has no window extensions" }
    }

    /** A window layout's folding feature as a posture: half opened is a tabletop where the hinge lies across, else a book. */
    private fun postureOf(info: Any): String {
        val feature = (info.javaClass.getMethod("getDisplayFeatures").invoke(info) as List<*>).firstOrNull()
            ?: return "no fold in this window"
        val bounds = feature.javaClass.getMethod("getBounds").invoke(feature) as Rect
        val half = feature.javaClass.getMethod("getState").invoke(feature) == HALF_OPENED
        val pose = when {
            !half -> "flat"
            bounds.width() > bounds.height() -> "half opened, tabletop"
            else -> "half opened, book"
        }
        return "$pose, hinge at ${bounds.left},${bounds.top} to ${bounds.right},${bounds.bottom}"
    }

    override fun onResume() {
        super.onResume()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val sensors = getSystemService(SensorManager::class.java)
        sensors.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE)?.let {
            sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
    }

    override fun onPause() {
        super.onPause()
        getSystemService(SensorManager::class.java).unregisterListener(this)
    }

    override fun onDestroy() {
        super.onDestroy()
        val component = layoutComponent ?: return
        runCatching {
            component.javaClass
                .getMethod("removeWindowLayoutInfoListener", Class.forName(CONSUMER))
                .invoke(component, layoutListener)
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        hinge.text = "Hinge angle: ${event.values[0].toInt()}"
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
}

/** The same screen in an activity that takes a fold's changes itself, as its manifest entry says: it is kept. */
class FoldKeptActivity : FoldActivity()
