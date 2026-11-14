package dev.appdyno.fixture

import android.app.Activity
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.widget.EditText
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.sqrt

/** The memory levels the system tells an app of, by their numbers, as the SDK deprecates most of their names. */
private val TRIM_LEVELS = mapOf(
    5 to "RUNNING_MODERATE",
    10 to "RUNNING_LOW",
    15 to "RUNNING_CRITICAL",
    20 to "UI_HIDDEN",
    40 to "BACKGROUND",
    60 to "MODERATE",
    80 to "COMPLETE",
)

/** A shake is a pull of this many times gravity, counted at most once in this long. */
private const val SHAKE_G = 2.5f
private const val SHAKE_GAP_MS = 500L
private const val KEPT = "kept"

/**
 * What the system tells the app: the memory levels it trims at and the shakes the accelerometer felt, counted while the
 * screen shows, a typed value kept by the saved instance state across an end the system makes, and when this process
 * started.
 */
class LifecycleActivity :
    Activity(),
    SensorEventListener {
    private val levels = mutableListOf<String>()
    private lateinit var trims: TextView
    private lateinit var shaken: TextView
    private lateinit var kept: EditText
    private var shakes = 0
    private var lastShake = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            trims = label("Trim levels: none", R.id.trim_levels)
            shaken = label("Shakes: 0", R.id.shakes)
            kept = EditText(context).apply {
                id = R.id.kept_value
                hint = "Kept value"
                // the activity keeps it, so what comes back is the saved instance state's and not the view's own
                isSaveEnabled = false
                setText(savedInstanceState?.getString(KEPT).orEmpty())
            }
            addView(kept)
            label("Process ${Process.myPid()} started ${startedAt()}", R.id.process_start)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(KEPT, kept.text.toString())
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        levels += TRIM_LEVELS[level] ?: "level $level"
        trims.text = "Trim levels: ${levels.joinToString(", ")}"
    }

    override fun onResume() {
        super.onResume()
        val sensors = getSystemService(SensorManager::class.java)
        sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
    }

    override fun onPause() {
        super.onPause()
        getSystemService(SensorManager::class.java).unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent) {
        val (x, y, z) = event.values
        val g = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
        val now = SystemClock.elapsedRealtime()
        if (g < SHAKE_G || now - lastShake < SHAKE_GAP_MS) return
        lastShake = now
        shakes++
        shaken.text = "Shakes: $shakes"
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit

    /** The wall-clock time this process started, by the system's record of its start. */
    private fun startedAt(): String {
        val ms = System.currentTimeMillis() - (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(ms))
    }
}
