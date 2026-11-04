package dev.appdyno.agent

class Options(val socket: String, val token: String, val idleExitMs: Long) {
    companion object {
        fun parse(args: Array<String>): Options {
            fun value(name: String) = args.indexOf(name).takeIf { it >= 0 && it + 1 < args.size }?.let { args[it + 1] }
            val socket = value("--socket") ?: throw IllegalArgumentException("--socket is required")
            val token = value("--token") ?: throw IllegalArgumentException("--token is required")
            require(Regex("[A-Za-z0-9_.-]{1,64}").matches(socket)) { "bad socket name" }
            require(token.length >= 16) { "token too short" }
            return Options(socket, token, value("--idle-exit-ms")?.toLong() ?: 30 * 60_000L)
        }
    }
}
