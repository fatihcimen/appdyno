import Foundation
import Network

/// One request's work: run on the main thread in arrival order, stopped by its deadline or a cancel.
final class Job {
    let id: Int
    let method: String
    let params: [String: Any]
    let deadline: Date
    private let lock = NSLock()
    private var _cancelled = false

    init(id: Int, method: String, params: [String: Any]) throws {
        self.id = id
        self.method = method
        self.params = params
        deadline = Date().addingTimeInterval(try requiredNumber(params, "_deadlineMs") / 1000)
    }

    var cancelled: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _cancelled }
        set { lock.lock(); _cancelled = newValue; lock.unlock() }
    }

    /// True once the caller no longer waits (cancelled, or past its deadline).
    var over: Bool { cancelled || Date() >= deadline }
}

/// What a method answers: a JSON result and, for a screenshot, the image bytes.
struct Reply {
    var result: [String: Any]
    var binary: Data?
}

/// The work queue the test method drains on the main thread (XCUI calls must run there).
final class MainPump {
    private let lock = NSLock()
    private var jobs: [() -> Void] = []
    private(set) var stopped = false

    /// A request came (one answered off the main thread, like ping): the runner is in use.
    func touch() { submit {} }

    func submit(_ work: @escaping () -> Void) {
        lock.lock(); jobs.append(work); lock.unlock()
    }

    func stop() { lock.lock(); stopped = true; lock.unlock() }

    private var lastWork = Date()

    /// Runs queued work until `stop()`, or until nothing came for `idleExit` seconds (a runner whose host
    /// is gone stops instead of lingering); between jobs the main run loop keeps turning.
    func run(idleExit: TimeInterval) {
        while true {
            lock.lock()
            let next = jobs.isEmpty ? nil : jobs.removeFirst()
            let done = stopped && jobs.isEmpty
            lock.unlock()
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

/// TCP server on the loopback: frames in, JSON-RPC requests out to the handler, replies back.
final class Server {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "server")
    private let token: String
    private let pump: MainPump
    private let handle: (Job) throws -> Reply
    private let hello: () -> [String: Any]
    private var running: [Int: Job] = [:]
    private let startedAt = Date()

    init(port: UInt16, token: String, pump: MainPump, hello: @escaping () -> [String: Any],
         handle: @escaping (Job) throws -> Reply) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
        self.token = token
        self.pump = pump
        self.hello = hello
        self.handle = handle
    }

    func start() {
        listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
        listener.start(queue: queue)
    }

    func stop() { listener.cancel() }

    private func accept(_ c: NWConnection) {
        let session = Session(connection: c)
        c.start(queue: queue)
        receive(session)
    }

    private final class Session {
        let connection: NWConnection
        let decoder = FrameDecoder()
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
            send(s, id: id, Reply(result: hello()))
            return
        }
        pump.touch()
        switch method {
        case "ping":
            send(s, id: id, Reply(result: ["uptimeMs": Int(Date().timeIntervalSince(startedAt) * 1000)]))
        case "cancel":
            if let target = (params["id"] as? NSNumber)?.intValue { running[target]?.cancelled = true }
            send(s, id: id, Reply(result: [:]))
        default:
            let job = try Job(id: id, method: method, params: params)
            running[id] = job
            pump.submit { [weak self] in
                guard let self else { return }
                var reply: Reply?
                var failure: AgentError?
                if job.cancelled {
                    failure = AgentError("CANCELLED", "cancelled before it started")
                } else if job.over {
                    failure = AgentError("TIMEOUT", "the deadline passed before the work started")
                } else {
                    do { reply = try self.handle(job) } catch let e as AgentError { failure = e } catch {
                        failure = AgentError("INTERNAL", "\(error)")
                    }
                }
                if failure == nil, job.cancelled { failure = AgentError("CANCELLED", "cancelled") }
                self.queue.async {
                    self.running[id] = nil
                    if let failure { self.sendError(s, id: id, failure) } else { self.send(s, id: id, reply!) }
                }
            }
        }
    }

    private func send(_ s: Session, id: Int, _ r: Reply) {
        var out = Data()
        if let b = r.binary { out.append(encodeBinary(id: UInt32(id), b)) }
        let body: [String: Any] = ["jsonrpc": "2.0", "id": id, "result": r.result]
        out.append(encodeJSON(try! JSONSerialization.data(withJSONObject: body)))
        s.connection.send(content: out, completion: .contentProcessed { _ in })
    }

    private func sendError(_ s: Session, id: Int, _ e: AgentError) {
        let body: [String: Any] = ["jsonrpc": "2.0", "id": id, "error": e.json]
        s.connection.send(content: encodeJSON(try! JSONSerialization.data(withJSONObject: body)),
                          completion: .contentProcessed { _ in })
    }
}
