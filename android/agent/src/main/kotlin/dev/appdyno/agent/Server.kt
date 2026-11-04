package dev.appdyno.agent

import android.net.LocalServerSocket
import android.net.LocalSocket
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.system.exitProcess

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

/**
 * The agent's server on an abstract unix socket (reachable only through adb on this device). The first
 * request of a connection must be `hello` with the launch token. Device work runs on one thread in order
 * (WorkLane); every request has a deadline after which the host gets TIMEOUT and the work is told to stop,
 * and a job stuck past it does not hold the requests behind it.
 */
/** How long the agent keeps its UI automation after the last host left. */
const val RELEASE_GRACE_MS = 2_000L

class Server(private val opts: Options, private val handlers: Handlers) {
    private val timers = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "appdyno-timers").apply { isDaemon = true } }
    private val actions = WorkLane(timers)
    private val jobs = ConcurrentHashMap<Int, Job>()
    private val streams = Streams()

    /** The connections that asked for the animations off. */
    private val animationsOff = HashSet<LocalSocket>()

    @Volatile
    private var lastActivity = SystemClock.uptimeMillis()

    @Volatile
    private var connections = 0

    fun run() {
        val server = LocalServerSocket(opts.socket)
        timers.scheduleWithFixedDelay({
            if (connections == 0 && SystemClock.uptimeMillis() - lastActivity > opts.idleExitMs) {
                System.err.println("idle for ${opts.idleExitMs} ms, exiting")
                exitProcess(0)
            }
        }, 10, 10, TimeUnit.SECONDS)
        while (true) {
            val socket = server.accept()
            Thread({ serve(socket) }, "appdyno-conn").apply { isDaemon = true }.start()
        }
    }

    private fun serve(socket: LocalSocket) {
        synchronized(this) { connections++ }
        var stream: Stream? = null
        try {
            val reader = FrameReader(socket.inputStream)
            val writer = FrameWriter(socket.outputStream)
            var authed = false
            while (true) {
                val frame = reader.read() ?: break
                lastActivity = SystemClock.uptimeMillis()
                if (frame !is Frame.Json) throw FrameException("the host sends JSON frames only")
                val msg = JSONObject(frame.text)
                val id = msg.optInt("id", -1)
                val method = msg.optString("method")
                val params = msg.optJSONObject("params") ?: JSONObject()
                if (!authed) {
                    if (method != "hello" || !handlers.tokenMatches(params.optString("token"))) {
                        writer.json(error(id, AgentFailure("POLICY_DENIED", "hello with the launch token first")))
                        break
                    }
                    authed = true
                }
                when (method) {
                    "hello" -> writer.json(result(id, handlers.hello()))
                    "ping" -> writer.json(result(id, handlers.ping()))
                    "cancel" -> {
                        jobs[params.optInt("id")]?.cancelled = true
                        writer.json(result(id, JSONObject()))
                    }
                    "animations.set" -> {
                        val off = params.getBoolean("off")
                        synchronized(animationsOff) {
                            if (off) animationsOff += socket else animationsOff -= socket
                            params.put("off", animationsOff.isNotEmpty())
                        }
                        submit(id, method, params, writer)
                    }
                    // on this thread, not the work lane: a person's finger and a stream wait for nothing
                    "touch" -> {
                        handlers.touch(params)
                        writer.json(result(id, JSONObject()))
                    }
                    "stream.start" -> {
                        stream?.let { streams.end(it) }
                        stream = streams.start(StreamRequest.from(params), ConnectionOutput(writer))
                        writer.json(result(id, JSONObject()))
                    }
                    "stream.clock" -> writer.json(result(id, JSONObject().put("now", System.nanoTime())))
                    "stream.sync" -> {
                        streams.requestKey()
                        writer.json(result(id, JSONObject()))
                    }
                    "stream.status" -> writer.json(result(id, streams.status()))
                    "shutdown" -> {
                        writer.json(result(id, JSONObject()))
                        exitProcess(0)
                    }
                    else -> submit(id, method, params, writer)
                }
            }
        } catch (e: Throwable) {
            System.err.println("connection closed: $e")
        } finally {
            // the display and the codec go with the host, however it went
            stream?.let { streams.end(it) }
            try {
                socket.close()
            } catch (_: Throwable) {
            }
            // the host that wanted them off is gone, however it went
            if (synchronized(animationsOff) { animationsOff.remove(socket) && animationsOff.isEmpty() }) {
                actions.submit(Job(-1), 60_000, {}) { handlers.restoreAnimations() }
            }
            val idle = synchronized(this) { --connections == 0 }
            lastActivity = SystemClock.uptimeMillis()
            // no host: accessibility off in the apps until the next one (an app starting meanwhile starts
            // without its cost); after a short grace, so a host that reconnects at once keeps it
            if (idle) timers.schedule({
                if (connections == 0) actions.submit(Job(-1), 60_000, {}) { if (connections == 0) handlers.release() }
            }, RELEASE_GRACE_MS, TimeUnit.MILLISECONDS)
        }
    }

    private fun submit(id: Int, method: String, params: JSONObject, writer: FrameWriter) {
        val job = Job(id)
        jobs[id] = job
        val replied = AtomicBoolean(false)
        val deadlineMs = params.optLong("_deadlineMs", 30_000).coerceIn(100, 600_000)
        val timedOut = {
            if (replied.compareAndSet(false, true)) {
                writer.safe { json(error(id, AgentFailure("TIMEOUT", "$method took longer than $deadlineMs ms"))) }
            }
        }
        actions.submit(job, deadlineMs, timedOut) {
            try {
                if (job.cancelled) throw AgentFailure("CANCELLED", "$method was cancelled before it started")
                val reply = handlers.handle(method, params, job)
                if (replied.compareAndSet(false, true)) {
                    val text = result(id, reply.result)
                    writer.safe { if (reply.binary != null) binaryThenJson(id, reply.binary, text) else json(text) }
                }
            } catch (t: Throwable) {
                if (replied.compareAndSet(false, true)) writer.safe { json(error(id, failure(t))) }
            } finally {
                jobs.remove(id)
            }
        }
    }

    private fun failure(t: Throwable): AgentFailure = when (t) {
        is AgentFailure -> t
        is java.lang.reflect.InvocationTargetException -> failure(t.targetException)
        is IllegalArgumentException, is org.json.JSONException ->
            AgentFailure("INVALID_ARGUMENT", t.message ?: t.toString(), cause = t)
        else -> {
            t.printStackTrace()
            AgentFailure("INTERNAL", t.toString(), cause = t)
        }
    }

    private fun result(id: Int, r: JSONObject) = JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", r).toString()

    private fun error(id: Int, f: AgentFailure): String {
        val data = JSONObject().put("code", f.code)
        f.hint?.let { data.put("hint", it) }
        val err = JSONObject().put("code", rpcCode(f.code)).put("message", f.message ?: f.code).put("data", data)
        return JSONObject().put("jsonrpc", "2.0").put("id", id).put("error", err).toString()
    }

    private inline fun FrameWriter.safe(block: FrameWriter.() -> Unit) {
        try {
            block()
        } catch (e: Throwable) {
            System.err.println("write failed: $e")
        }
    }
}
