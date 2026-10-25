package dev.appdyno.agent

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.os.IBinder
import java.lang.reflect.Method

/**
 * Access to framework internals an app_process server needs (it has no app context of its own). Every
 * lookup is by name and parameter types at run time, so a release that changes a signature fails with a
 * typed error instead of a crash, and the call that matches is chosen by its parameter types.
 */
@SuppressLint("PrivateApi", "DiscouragedPrivateApi", "SoonBlockedPrivateApi")
object Platform {
    /** Lifts the non-SDK interface checks for this process (no effect where they are not enforced). */
    fun exemptHiddenApis() {
        if (Build.VERSION.SDK_INT < 28) return
        try {
            val forName = Class::class.java.getDeclaredMethod("forName", String::class.java)
            val getDeclared = Class::class.java.getDeclaredMethod(
                "getDeclaredMethod",
                String::class.java,
                arrayOf<Class<*>>()::class.java,
            )
            val vmRuntime = forName.invoke(null, "dalvik.system.VMRuntime") as Class<*>
            val getRuntime = getDeclared.invoke(vmRuntime, "getRuntime", null) as Method
            val setExemptions = getDeclared.invoke(
                vmRuntime,
                "setHiddenApiExemptions",
                arrayOf<Class<*>>(Array<String>::class.java),
            ) as Method
            setExemptions.invoke(getRuntime.invoke(null), arrayOf("L"))
        } catch (_: Throwable) {
            // best effort: app_process servers usually run without enforcement anyway
        }
    }

    /** The system context of a framework thread created in this process. */
    val systemContext: Context by lazy {
        val at = Class.forName("android.app.ActivityThread")
        val thread = at.getDeclaredConstructor().apply { isAccessible = true }.newInstance()
        at.getDeclaredField("sCurrentActivityThread").apply { isAccessible = true }.set(null, thread)
        at.getDeclaredMethod("getSystemContext").invoke(thread) as Context
    }

    fun service(name: String): IBinder {
        val sm = Class.forName("android.os.ServiceManager")
        return sm.getDeclaredMethod("getService", String::class.java).invoke(null, name) as IBinder?
            ?: throw AgentFailure("UNSUPPORTED", "no $name service on this device")
    }

    fun asInterface(stubClass: String, binder: IBinder): Any =
        Class.forName(stubClass).getDeclaredMethod("asInterface", IBinder::class.java).invoke(null, binder)!!

    /**
     * Calls the first public method named `name` whose parameters can all be filled from `values`
     * (values are taken in order per parameter type; an Int or a String the values lack is 0 / null).
     */
    fun callByTypes(target: Any, name: String, vararg values: Any?): Any? {
        val methods = target.javaClass.methods.filter { it.name == name }
            .sortedByDescending { it.parameterTypes.size }
        val failure = AgentFailure("UNSUPPORTED", "$name has no known signature on this release")
        for (m in methods) {
            val pool = values.toMutableList()
            val args = m.parameterTypes.map { type ->
                val i = pool.indexOfFirst { v -> v != null && boxed(type).isInstance(v) }
                when {
                    i >= 0 -> pool.removeAt(i)
                    type == Int::class.javaPrimitiveType -> 0
                    type == Long::class.javaPrimitiveType -> 0L
                    type == Boolean::class.javaPrimitiveType -> false
                    !type.isPrimitive -> null
                    else -> return@map Unfillable
                }
            }
            if (args.any { it === Unfillable }) continue
            return try {
                m.invoke(target, *args.toTypedArray())
            } catch (e: java.lang.reflect.InvocationTargetException) {
                throw e.targetException
            }
        }
        throw failure
    }

    private object Unfillable

    private fun boxed(t: Class<*>): Class<*> = when (t) {
        Int::class.javaPrimitiveType -> Integer::class.java
        Long::class.javaPrimitiveType -> java.lang.Long::class.java
        Boolean::class.javaPrimitiveType -> java.lang.Boolean::class.java
        Float::class.javaPrimitiveType -> java.lang.Float::class.java
        else -> t
    }

    /** The default display's logical size, density and rotation (falls back to the resources' metrics). */
    fun display(): DisplayInfo {
        try {
            val global = Class.forName("android.hardware.display.DisplayManagerGlobal")
            val instance = global.getDeclaredMethod("getInstance").invoke(null)
            val info = global.getDeclaredMethod("getDisplayInfo", Int::class.javaPrimitiveType).invoke(instance, 0)!!
            val c = info.javaClass
            return DisplayInfo(
                c.getField("logicalWidth").getInt(info),
                c.getField("logicalHeight").getInt(info),
                c.getField("logicalDensityDpi").getInt(info),
                c.getField("rotation").getInt(info),
            )
        } catch (_: Throwable) {
            val m = android.content.res.Resources.getSystem().displayMetrics
            return DisplayInfo(m.widthPixels, m.heightPixels, m.densityDpi, 0)
        }
    }
}

class DisplayInfo(val width: Int, val height: Int, val densityDpi: Int, val rotation: Int)
