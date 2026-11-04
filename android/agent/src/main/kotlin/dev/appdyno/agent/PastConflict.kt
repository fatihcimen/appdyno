package dev.appdyno.agent

/**
 * `attempt` again while it is refused as AGENT_CONFLICT, at most `waitMs`: the system keeps UI automation for a
 * holder that was killed for about 2 s after its process has gone (measured on an emulator: held at 1.3 s, free at
 * 2.3 s), and a client that only came too early must not be told that someone else holds the device.
 */
internal fun <T> pastConflict(
    waitMs: Long,
    pauseMs: Long,
    clock: () -> Long,
    pause: (Long) -> Unit,
    attempt: () -> T,
): T {
    val end = clock() + waitMs
    while (true) {
        try {
            return attempt()
        } catch (e: AgentFailure) {
            if (e.code != "AGENT_CONFLICT" || clock() >= end) throw e
            pause(pauseMs)
        }
    }
}
