package dev.appdyno.agent

import android.annotation.SuppressLint
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.IBinder
import android.view.Surface
import java.lang.reflect.Method

/**
 * The screen drawn into a surface, by hidden platform calls, found by name at run time: a display that
 * mirrors the main one where the release has that (proven on 14 and 16), else one made directly (proven on
 * 11). What differs between releases is behaviour read in scrcpy's source (see THIRD_PARTY_NOTICES).
 */
@SuppressLint("PrivateApi")
class DisplayMirror private constructor(val how: String, private val release: () -> Unit) {
    fun release() = release.invoke()

    companion object {
        private const val NAME = "appdyno-mirror"

        fun create(w: Int, h: Int, screen: DisplayInfo, surface: Surface): DisplayMirror {
            val mirrored = try {
                DisplayManager::class.java.getMethod(
                    "createVirtualDisplay",
                    String::class.java,
                    Int::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType,
                    Surface::class.java,
                )
            } catch (_: NoSuchMethodException) {
                null
            }
            return if (mirrored != null) byDisplayManager(mirrored, w, h, surface) else bySurfaceControl(w, h, screen, surface)
        }

        private fun byDisplayManager(method: Method, w: Int, h: Int, surface: Surface): DisplayMirror {
            val display = method.invoke(null, NAME, w, h, 0, surface)
                ?: throw AgentFailure("UNSUPPORTED", "no mirror of the display on this release")
            return DisplayMirror("display manager") { display.javaClass.getMethod("release").invoke(display) }
        }

        private fun bySurfaceControl(w: Int, h: Int, screen: DisplayInfo, surface: Surface): DisplayMirror {
            val control = Class.forName("android.view.SurfaceControl")
            // secure windows are drawn only for a secure display, which a shell may make only up to Android 11
            val secure = Build.VERSION.SDK_INT <= Build.VERSION_CODES.R
            val display = control.getMethod("createDisplay", String::class.java, Boolean::class.javaPrimitiveType)
                .invoke(null, NAME, secure) as IBinder
            control.getMethod("openTransaction").invoke(null)
            try {
                control.getMethod("setDisplaySurface", IBinder::class.java, Surface::class.java).invoke(null, display, surface)
                control.getMethod(
                    "setDisplayProjection",
                    IBinder::class.java,
                    Int::class.javaPrimitiveType,
                    Rect::class.java,
                    Rect::class.java,
                ).invoke(null, display, 0, Rect(0, 0, screen.width, screen.height), Rect(0, 0, w, h))
                control.getMethod("setDisplayLayerStack", IBinder::class.java, Int::class.javaPrimitiveType).invoke(null, display, 0)
            } finally {
                control.getMethod("closeTransaction").invoke(null)
            }
            return DisplayMirror("surface control") {
                control.getMethod("destroyDisplay", IBinder::class.java).invoke(null, display)
            }
        }
    }
}
