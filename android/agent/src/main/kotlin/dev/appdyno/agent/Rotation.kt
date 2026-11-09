package dev.appdyno.agent

/**
 * The screen frozen at a rotation, which turns the rotation lock on: the lock and the user rotation come back as they
 * were once it is turned back to the rotation it had, or when the host that turned it leaves.
 */
class Rotation(private val automation: Automation) {
    private val lock = HeldSettings("system", listOf("user_rotation", "accelerometer_rotation"))
    private var from: Int? = null

    @Synchronized
    fun set(rotation: Int) {
        if (lock.hold()) from = Platform.display().rotation
        automation.ua.setRotation(rotation)
        if (rotation == from) restore()
    }

    @Synchronized
    fun restore() {
        from = null
        lock.restore()
    }
}
