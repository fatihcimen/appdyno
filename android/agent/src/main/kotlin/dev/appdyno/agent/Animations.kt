package dev.appdyno.agent

/** The device's animation scales, off on request and back as they were when the last host leaves. */
class Animations {
    private val scales = HeldSettings("global", KEYS)

    @Synchronized
    fun off() {
        if (!scales.hold()) return
        for (k in KEYS) sh("settings", "put", "global", k, "0")
    }

    fun restore() = scales.restore()

    private companion object {
        val KEYS = listOf("window_animation_scale", "transition_animation_scale", "animator_duration_scale")
    }
}
