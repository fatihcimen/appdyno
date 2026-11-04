package dev.appdyno.agent

/** The app windows of a screen by id (pure, unit tested). */
object WindowIds {
    fun app(windows: List<Pair<Int, Int>>): Set<Int> =
        windows.filter { it.second == android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION }.map { it.first }.toSet()

    /** Another app window came in front, or the one read is gone (an unknown id proves nothing). */
    fun replaced(then: Set<Int>, now: Set<Int>) = -1 !in then && then.isNotEmpty() && now.isNotEmpty() && then != now
}
