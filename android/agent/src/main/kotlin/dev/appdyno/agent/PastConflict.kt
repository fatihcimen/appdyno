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

/**
 * The connections of this process the system may hold still, let go by `letGo` (true once it holds nothing of one). A
 * connect that timed out on a loaded device was registered by the system all the same: every later open of the process
 * was refused as AGENT_CONFLICT for minutes, the device held by the very agent that asked (load 380).
 */
internal class Unreleased<C>(private val letGo: (C) -> Boolean) {
    private val kept = ArrayList<C>()

    /** `open` on a connection `made` for it, after letting go again of those kept; one whose open fails otherwise than by a conflict is let go. */
    fun <T> open(made: C, open: (C) -> T): T {
        kept.retainAll { !letGo(it) }
        try {
            return open(made)
        } catch (e: Throwable) {
            if ((e as? AgentFailure)?.code != "AGENT_CONFLICT") keep(made)
            throw e
        }
    }

    /** Lets go of one, as a connection whose open failed or that is closed, and keeps it where that failed. */
    fun keep(c: C) {
        if (!letGo(c)) kept += c
    }

    /**
     * A conflict that outlasted the wait, while one is kept, is that one: the system lets it go only with this process,
     * which says so as AGENT_UNAVAILABLE and ends, and the host's next call starts another agent.
     */
    fun told(e: AgentFailure): AgentFailure = if (e.code == "AGENT_CONFLICT" && kept.isNotEmpty()) {
        AgentFailure(
            "AGENT_UNAVAILABLE",
            "UI automation is held by this agent's own connection, which it could not let go after an open that failed: " +
                "the system lets it go when the agent ends, and the agent ends now",
            "try once more: the next call starts another agent",
            e,
        )
    } else {
        e
    }
}
