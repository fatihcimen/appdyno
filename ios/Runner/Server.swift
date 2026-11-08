import Foundation
import Network
import os

/// What a method answers: a JSON result and, for a screenshot, the image bytes.
struct Reply {
    var result: [String: Any]
    var binary: Data?
}

/// The one way a request reaches the main actor, where XCUI must be asked: the network's queue hands its work here, and
/// the test method drains it on the main thread.
final class MainPump: Sendable {
    typealias Work = @MainActor @Sendable () -> Void
    private let state = OSAllocatedUnfairLock(initialState: (jobs: [Work](), stopped: false))

    /// A request came (one answered off the main thread, like ping): the runner is in use.
    func touch() { submit {} }

    func submit(_ work: @escaping Work) { state.withLock { $0.jobs.append(work) } }

    func stop() { state.withLock { $0.stopped = true } }

    /// Runs queued work until `stop()`, or until nothing came for `idleExit` seconds (a runner whose host
    /// is gone stops instead of lingering); between jobs the main run loop keeps turning.
    @MainActor func run(idleExit: TimeInterval) {
        var lastWork = Date()
        while true {
            let (next, done) = state.withLock { s -> (Work?, Bool) in
                let next = s.jobs.isEmpty ? nil : s.jobs.removeFirst()
                return (next, s.stopped && s.jobs.isEmpty)
            }
            if let next { lastWork = Date(); next(); continue }
            if done { return }
            if Date().timeIntervalSince(lastWork) > idleExit {
                NSLog("appdyno runner: no request for %.0f s, stopping", idleExit)
                return
            }
            // false: the loop has no input source and returned at once; sleep instead of spinning
            if !RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01)) {
                Thread.sleep(forTimeInterval: 0.01)
            }
        }
    }
}

/// TCP server, frames in, JSON-RPC requests out to the handler, replies back: on the loopback, which a cable reaches, and on a
/// phone paired for Wi-Fi by a tunnel too, which is how a Mac reaches one with none. No listener can be kept to a tunnel, as
/// its interface comes after the listener and its path names the Wi-Fi it rides on as well: so a connection is read only when
/// it came by the loopback, or by an interface of a tunnel's kind between a tunnel's two ends, and any other is closed
/// unread, a VPN's among them.
final class Server: Sendable {
    private let listeners: [NWListener]
    private let queue = DispatchQueue(label: "server")
    private let token: String
    private let pump: MainPump
    private let handle: @MainActor @Sendable (Job) throws -> Reply
    private let hello: @Sendable () -> [String: Any]
    private let startedAt = Date()

    init(port: UInt16, token: String, tunnels: Bool, pump: MainPump, hello: @escaping @Sendable () -> [String: Any],
         handle: @escaping @MainActor @Sendable (Job) throws -> Reply) throws {
        let loopback = NWParameters.tcp
        loopback.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
        loopback.allowLocalEndpointReuse = true
        let tunnel = NWParameters.tcp
        tunnel.allowLocalEndpointReuse = true
        listeners = [try NWListener(using: loopback)]
            + (tunnels ? [try NWListener(using: tunnel, on: NWEndpoint.Port(rawValue: port)!)] : [])
        self.token = token
        self.pump = pump
        self.hello = hello
        self.handle = handle
    }

    func start() {
        for listener in listeners {
            listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
            listener.start(queue: queue)
        }
    }

    func stop() { listeners.forEach { $0.cancel() } }

    private static func bytes(_ endpoint: NWEndpoint?) -> [UInt8] {
        guard case let .hostPort(.ipv6(address), _)? = endpoint else { return [] }
        return [UInt8](address.rawValue)
    }

    private func accept(_ c: NWConnection) {
        let session = Session(connection: c)
        c.stateUpdateHandler = { [weak self] state in
            guard case .ready = state else { return }
            c.stateUpdateHandler = nil
            guard let path = c.currentPath, path.usesInterfaceType(.loopback)
                || (path.usesInterfaceType(.other)
                    && tunnelEnds(local: Self.bytes(path.localEndpoint), remote: Self.bytes(c.endpoint)))
            else {
                c.cancel()
                return
            }
            self?.receive(session)
        }
        c.start(queue: queue)
    }

    /// Unchecked: only the server's queue touches it, where each of its connection's callbacks runs.
    private final class Session: @unchecked Sendable {
        let connection: NWConnection
        let decoder = FrameDecoder()
        let jobs = JobTable()
        var greeted = false
        init(connection: NWConnection) { self.connection = connection }
    }

    private func receive(_ s: Session) {
        s.connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, done, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                do {
                    for frame in try s.decoder.push(data) {
                        guard case let .json(payload) = frame else { throw FrameError.unknownType(1) }
                        try self.request(payload, s)
                    }
                } catch {
                    s.connection.cancel()
                    return
                }
            }
            if done || error != nil { s.connection.cancel(); return }
            self.receive(s)
        }
    }

    private func request(_ payload: Data, _ s: Session) throws {
        guard let msg = try JSONSerialization.jsonObject(with: payload) as? [String: Any],
              let id = (msg["id"] as? NSNumber)?.intValue, let method = msg["method"] as? String
        else { throw FrameError.unknownType(0) }
        let params = msg["params"] as? [String: Any] ?? [:]
        if !s.greeted {
            guard method == "hello", let t = params["token"] as? String, t.count >= 16, sameToken(t, token) else {
                s.connection.cancel()
                return
            }
            s.greeted = true
            send(s, Self.frame(id: id, Reply(result: hello())))
            return
        }
        pump.touch()
        switch method {
        case "ping":
            let now = Date()
            send(s, Self.frame(id: id, Reply(result: ["uptimeMs": Int(now.timeIntervalSince(startedAt) * 1000),
                                                      "atMs": now.timeIntervalSince1970 * 1000])))
        case "cancel":
            s.jobs.cancel(try OneValue.id(params))
            send(s, Self.frame(id: id, Reply(result: [:])))
        default:
            let job = try Job(id: id, method: method, params: params)
            s.jobs.add(job)
            pump.submit { [handle, queue] in
                let answer = Self.answer(job, handle)
                queue.async {
                    s.jobs.remove(job)
                    s.connection.send(content: answer, completion: .contentProcessed { _ in })
                }
            }
        }
    }

    /// The job's answer as the bytes that go back: made on the main actor, so that only bytes leave it.
    @MainActor private static func answer(_ job: Job, _ handle: (Job) throws -> Reply) -> Data {
        var reply: Reply?
        var failure: AgentError?
        if job.cancelled {
            failure = AgentError("CANCELLED", "cancelled before it started")
        } else if job.over {
            failure = AgentError("TIMEOUT", "the deadline passed before the work started")
        } else {
            do { reply = try handle(job) } catch let e as AgentError { failure = e } catch {
                failure = AgentError("INTERNAL", "\(error)")
            }
        }
        if failure == nil, job.cancelled { failure = AgentError("CANCELLED", "cancelled") }
        if let failure {
            return encodeJSON(try! JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": job.id, "error": failure.json]))
        }
        return frame(id: job.id, reply!)
    }

    private static func frame(id: Int, _ r: Reply) -> Data {
        var out = Data()
        if let b = r.binary { out.append(encodeBinary(id: UInt32(id), b)) }
        let body: [String: Any] = ["jsonrpc": "2.0", "id": id, "result": r.result]
        out.append(encodeJSON(try! JSONSerialization.data(withJSONObject: body)))
        return out
    }

    private func send(_ s: Session, _ frame: Data) {
        s.connection.send(content: frame, completion: .contentProcessed { _ in })
    }
}
