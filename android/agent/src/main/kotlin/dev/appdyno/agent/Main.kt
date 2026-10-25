package dev.appdyno.agent

import android.os.Looper
import kotlin.system.exitProcess

/**
 * Entry point of `app_process / dev.appdyno.agent.Main --socket <name> --token <secret>`, run as the
 * shell user with this APK as its class path. Exit codes: 2 bad arguments, 3 the automation connection
 * could not be opened (the reason on stderr, starting with the error code).
 */
@Suppress("DEPRECATION") // prepareMainLooper: an app_process server has no ActivityThread to prepare it
object Main {
    @JvmStatic
    fun main(args: Array<String>) {
        val opts = try {
            Options.parse(args)
        } catch (e: IllegalArgumentException) {
            System.err.println("INVALID_ARGUMENT: ${e.message}")
            exitProcess(2)
        }
        Platform.exemptHiddenApis()
        if (Looper.getMainLooper() == null) Looper.prepareMainLooper()
        val automation = try {
            Automation.connect()
        } catch (e: AgentFailure) {
            System.err.println("${e.code}: ${e.message}")
            exitProcess(3)
        } catch (e: Throwable) {
            System.err.println("INTERNAL: could not open UI automation: $e")
            exitProcess(3)
        }
        println("ready ${BuildConfig.VERSION_NAME}")
        Server(opts, Handlers(automation, opts.token)).run()
    }
}
